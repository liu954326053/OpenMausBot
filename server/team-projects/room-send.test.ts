import { describe, expect, it } from "vitest";

import type { Message } from "../store.ts";
import { quietMentions, sendToRoom, type RoomSendDeps } from "./room-send.ts";

function room(working: boolean, overBudget = false) {
  const started: Array<{ groupId: string; text: string; line: unknown }> = [];
  const queued: Array<{ groupId: string; threadId: string; text: string; line: unknown }> = [];
  const deps: RoomSendDeps = {
    working: () => working,
    queue: (groupId, threadId, text, line) => {
      queued.push({ groupId, threadId, text, line });
      return { id: "q1" };
    },
    start: (groupId, text, line) => {
      started.push({ groupId, text, line });
      return { id: "m1", at: 5, role: "user", kind: "text", text } as Message;
    },
    withinBudget: () => {
      if (overBudget) throw new Error("spend cap reached");
    },
  };
  return { deps, started, queued };
}

const MESSAGE = {
  groupId: "g1",
  threadId: "t1",
  to: [{ botId: "b1", name: "Jade", text: "Design the bride. ＠Mo said ＠everyone likes her." }, { botId: "b2", name: "Hue", text: "Paint her." }],
  trigger: { kind: "bot" as const, botId: "lead" },
};

describe("a line into a project's group chat", () => {
  it("starts the room's turn for the bots it addresses, each by name", () => {
    const { deps, started, queued } = room(false);
    expect(sendToRoom(deps, MESSAGE)).toEqual({ ok: true, threadId: "t1", message: expect.objectContaining({ id: "m1" }) });
    expect(queued).toEqual([]);
    expect(started).toEqual([{
      groupId: "g1",
      text: "@Jade Design the bride. ＠Mo said ＠everyone likes her.\n\n@Hue Paint her.",
      line: { trigger: { kind: "bot", botId: "lead" }, mentions: ["b1", "b2"], threadId: "t1" },
    }]);
  });

  it("waits in the room's queue while a turn runs there, with the person who sent it", () => {
    const { deps, started, queued } = room(true);
    const sender = { name: "Ada" };
    expect(sendToRoom(deps, { ...MESSAGE, sender })).toEqual({ ok: true, queued: true, queueId: "q1", threadId: "t1" });
    expect(started).toEqual([]);
    expect(queued[0]).toMatchObject({ groupId: "g1", threadId: "t1", line: { mode: "chat", mentions: ["b1", "b2"], sender } });
  });

  it("is refused at the spend cap, and nothing is sent", () => {
    const { deps, started, queued } = room(false, true);
    expect(() => sendToRoom(deps, MESSAGE)).toThrow("spend cap reached");
    expect([...started, ...queued]).toEqual([]);
  });

  it("quotes text with its mentions made plain, and the files it attaches as they are", () => {
    expect(quietMentions("ask @Mo and mail a@b.c <attached-image path=\"/tmp/a@b/x.png\" name=\"x@2.png\"/> @everyone"))
      .toBe("ask ＠Mo and mail a＠b.c <attached-image path=\"/tmp/a@b/x.png\" name=\"x@2.png\"/> ＠everyone");
  });
});
