import { describe, expect, it } from "vitest";

import { PERSON_STOPPED_TURN_NAME } from "../../shared/client-cancel.ts";
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { CANVAS_CONTENT_MAX_CHARS } from "../../shared/project-canvas.ts";
import type { Message } from "../store.ts";
import { replyText, type TaskTarget, TaskTargets } from "./task-targets.ts";

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
const where = { projectId: "p1", botId: "writer", threadId: "w", title: "Write the logline" };
const turnEnd = (requestMessageId: string, at: number, text: string): Message => ({
  id: `reply-${at}`, at, role: "bot", kind: "text", text, turnId: `t${at}`, turnTerminal: true, turnSucceeded: true, requestMessageId,
});

describe("a reply as a text node's text", () => {
  it("is redacted before it is cut to the canvas's limit, and a cut keeps whole characters", () => {
    expect(replyText(`${"a".repeat(CANVAS_CONTENT_MAX_CHARS - 1)}😀 and more`)).toBe("a".repeat(CANVAS_CONTENT_MAX_CHARS - 1));
    const keyAtTheCut = replyText(`${"a".repeat(CANVAS_CONTENT_MAX_CHARS - 20)} ${KEY}`);
    expect(keyAtTheCut).not.toContain("sk-ant");
    expect(keyAtTheCut.length).toBeLessThanOrEqual(CANVAS_CONTENT_MAX_CHARS);
  });
});

describe("the text nodes replies go into", () => {
  it("in a group chat end at the turns of the bot each task is for, or at a turn's end that names no bot", () => {
    const targets = new TaskTargets();
    const room = { projectId: "p1", threadId: "room", title: "Write the logline", inRoom: true as const };
    const said = (botId: string, at: number, patch: Partial<Message> = {}): Message =>
      ({ id: `${botId}-${at}`, at, role: "bot", kind: "text", text: `${botId} at ${at}`, turnTerminal: true, turnSucceeded: true, from: { botId, name: botId, color: "blue" }, ...patch }) as Message;
    const failed = (at: number, botId?: string): Message =>
      ({ id: `failed-${at}`, at, role: "bot", kind: "activity", tool: failedTurnTool("The engine stopped answering."), ...(botId ? { from: { botId, name: botId, color: "blue" } } : {}) }) as Message;
    const writer = { ...room, botId: "writer", nodeId: "n1", requestId: "m1", requestAt: 1 };
    const painter = { ...room, botId: "painter", nodeId: "n2", queueId: "q1" };
    targets.add(writer);
    targets.add(painter);
    expect(targets.heard("room", said("lead", 2))).toBeNull();
    expect(targets.heard("room", failed(3, "painter"))).toBeNull();
    expect(targets.of("p1")).toEqual([writer, painter]);
    expect(targets.heard("room", said("writer", 4))).toEqual({ target: writer, reply: "writer at 4" });
    expect(targets.heard("room", { id: "m5", at: 5, role: "user", kind: "text", text: "@painter go", queueId: "q1" })).toBeNull();
    expect(targets.of("p1")).toEqual([{ ...painter, requestId: "m5", requestAt: 5 }]);
    const summary = (at: number): Message =>
      ({ id: `digest-${at}`, at, role: "bot", kind: "digest", text: "[digest]", from: { botId: "painter", name: "painter", color: "blue" } }) as Message;
    expect(targets.heard("room", summary(6))).toBeNull();
    expect(targets.of("p1")).toEqual([]);
    const lead = { ...room, botId: "lead", nodeId: "n3", requestId: "m8", requestAt: 8 };
    targets.add(lead);
    expect(targets.heard("room", failed(9))).toBeNull();
    expect(targets.of("p1")).toEqual([]);
  });

  it("keep each task for a node until the turn for it ends, and a blank reply ends its task with nothing to write", () => {
    const targets = new TaskTargets();
    const [first, second] = [{ ...where, nodeId: "n1", requestId: "m1", requestAt: 1 }, { ...where, nodeId: "n1", requestId: "m2", requestAt: 3 }];
    targets.add(first);
    targets.add(second);
    expect(targets.of("p1")).toEqual([first, second]);
    expect(targets.heard("w", turnEnd("m1", 2, "Done"))).toEqual({ target: first, reply: "Done" });
    expect(targets.of("p1")).toEqual([second]);
    expect(targets.heard("w", turnEnd("m2", 4, "  "))).toEqual({ target: second });
    expect(targets.of("p1")).toEqual([]);
  });

  it("end every earlier task of a conversation once a turn there fails or is stopped with no line of its own, or queued messages start the next turn there", () => {
    const targets = new TaskTargets();
    const task = (nodeId: string, sent: Pick<TaskTarget, "requestId" | "requestAt" | "queueId">, threadId = "w"): TaskTarget => ({ ...where, threadId, nodeId, ...sent });
    const row = (id: string, at: number, tool: NonNullable<Message["tool"]>): Message => ({ id, at, role: "bot", kind: "activity", tool, turnId: `t${at}` });
    const elsewhere = task("n2", { requestId: "x1", requestAt: 1 }, "x");
    const failing = task("n1", { requestId: "m1", requestAt: 1 });
    targets.add(elsewhere);
    targets.add(failing);
    expect(targets.heard("w", row("a2", 2, { ...failedTurnTool("one step failed"), partial: true }))).toBeNull();
    expect(targets.of("p1")).toEqual([elsewhere, failing]);
    expect(targets.heard("w", row("a3", 3, failedTurnTool("The engine stopped answering.")))).toBeNull();
    expect(targets.of("p1")).toEqual([elsewhere]);

    targets.add(task("n1", { requestId: "m4", requestAt: 4 }));
    expect(targets.heard("w", row("a5", 5, { name: PERSON_STOPPED_TURN_NAME, ok: true }))).toBeNull();
    expect(targets.of("p1")).toEqual([elsewhere]);

    const [merged, last, waiting] = [task("n1", { queueId: "q1" }), task("n3", { queueId: "q2" }), task("n1", { queueId: "q3" })];
    for (const one of [merged, last, waiting]) targets.add(one);
    targets.heard("w", { id: "m6", at: 6, role: "user", kind: "text", text: "Revise it", queueId: "q1" });
    expect(targets.of("p1")).toEqual([elsewhere, merged, last, waiting]);
    targets.heard("w", { id: "m7", at: 6, role: "user", kind: "text", text: "Write it", queueId: "q2" });
    expect(targets.of("p1")).toEqual([elsewhere, last, waiting]);
    expect(last).toMatchObject({ requestId: "m7", requestAt: 6 });
    expect(targets.heard("w", turnEnd("m7", 8, "Both"))).toEqual({ target: last, reply: "Both" });
    expect(targets.of("p1")).toEqual([elsewhere, waiting]);
  });
});
