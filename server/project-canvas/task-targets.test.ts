import { describe, expect, it } from "vitest";

import { CANVAS_CONTENT_MAX_CHARS } from "../../shared/project-canvas.ts";
import type { Message } from "../store.ts";
import { replyText, TaskTargets } from "./task-targets.ts";

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
});
