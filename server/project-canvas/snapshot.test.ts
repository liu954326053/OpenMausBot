import { describe, expect, it } from "vitest";

import { CANVAS_OUTPUT_MAX_CHARS, type CanvasDocument, type CanvasNode } from "../../shared/project-canvas.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { buildSnapshot, type BotFacts, type SnapshotInput, type ThreadFacts } from "./snapshot.ts";

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

function thread(threadId: string, patch: Partial<ThreadFacts> = {}): ThreadFacts {
  return { threadId, busy: false, waitingOnPerson: false, queued: false, failed: false, lastAt: 1, ...patch };
}

function bot(id: string, threads: ThreadFacts[] = [thread(`${id}-main`)]): BotFacts {
  return { id, name: id[0]!.toUpperCase() + id.slice(1), title: `${id} title`, threads };
}

function canvas(nodes: CanvasNode[] = [], connections: CanvasDocument["connections"] = []): CanvasDocument {
  return { projectId: "p1", revision: 3, nodes, connections, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" };
}

function input(patch: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    document: canvas(),
    project: { id: "p1", name: "Stand-in bride", leadBotId: "lead", archived: false, folderState: "ready" },
    bots: [bot("lead"), bot("writer"), bot("boards")],
    parentOf: () => undefined,
    sees: () => true,
    ...patch,
  };
}

const card: OptionCardData = { title: "Run a command?", subtitle: `curl -H "Authorization: Bearer ${KEY}"`, options: ["Allow", "Deny"], requestType: "permission" };

describe("the bots on a project's canvas", () => {
  it("are a node each, named, at their stored place or the default layout", () => {
    const stored: CanvasNode = { id: "bot:writer", type: "bot", title: "", position: { x: 5, y: 6 }, width: 320, height: 200 };
    const snapshot = buildSnapshot(input({ document: canvas([stored]) }));
    expect(snapshot.nodes.map((node) => [node.id, node.title])).toEqual([["bot:lead", "Lead"], ["bot:writer", "Writer"], ["bot:boards", "Boards"]]);
    expect(snapshot.nodes[1]).toMatchObject({ position: { x: 5, y: 6 }, width: 320, height: 200 });
    expect(snapshot.bots.writer).toMatchObject({ name: "Writer", title: "writer title", lead: false, placed: true });
    expect(snapshot.bots.lead).toMatchObject({ lead: true, placed: false });
    expect(snapshot.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it("drop a bot that left, keep what it made, and show only connections whose two ends are there", () => {
    const left: CanvasNode = { id: "bot:gone", type: "bot", title: "", position: { x: 0, y: 0 }, width: 300, height: 180 };
    const made: CanvasNode = { id: "draft", type: "text", title: "Draft", position: { x: 400, y: 0 }, width: 340, height: 240, createdBy: { kind: "bot", botId: "gone" } };
    const snapshot = buildSnapshot(input({ document: canvas([left, made], [
      { id: "c1", fromNodeId: "bot:gone", toNodeId: "draft", kind: "content" },
      { id: "c2", fromNodeId: "draft", toNodeId: "bot:writer", kind: "content" },
    ]) }));
    expect(snapshot.nodes.map((node) => node.id)).toEqual(["bot:lead", "bot:writer", "bot:boards", "draft"]);
    expect(snapshot.connections.filter((one) => one.kind === "content").map((one) => one.id)).toEqual(["c2"]);
    expect(snapshot.bots).not.toHaveProperty("gone");
  });

  it("are joined by dispatch connections from the flow, the lead above any bot the flow does not place", () => {
    const snapshot = buildSnapshot(input({ parentOf: (id) => (id === "boards" ? "writer" : undefined) }));
    expect(snapshot.connections).toEqual([
      { id: "dispatch:lead:writer", fromNodeId: "bot:lead", toNodeId: "bot:writer", kind: "dispatch" },
      { id: "dispatch:writer:boards", fromNodeId: "bot:writer", toNodeId: "bot:boards", kind: "dispatch" },
    ]);
  });
});

describe("a bot's status", () => {
  const statusOf = (threads: ThreadFacts[]) => buildSnapshot(input({ bots: [bot("lead", threads)] })).bots.lead!.status;

  it("says what needs the person first, then work, then the queue, then a failure", () => {
    expect(statusOf([thread("a", { busy: true }), thread("b", { card: { messageId: "m", at: 2, card } })])).toBe("waiting");
    expect(statusOf([thread("a", { waitingOnPerson: true })])).toBe("waiting");
    expect(statusOf([thread("a", { busy: true }), thread("b", { queued: true })])).toBe("working");
    expect(statusOf([thread("a", { queued: true })])).toBe("queued");
    expect(statusOf([thread("a", { failed: true, lastAt: 5 }), thread("b", { lastAt: 2 })])).toBe("error");
    expect(statusOf([thread("a", { failed: true, lastAt: 1 }), thread("b", { lastAt: 2 })])).toBe("idle");
    expect(statusOf([])).toBe("idle");
  });
});

describe("what a bot's node says", () => {
  it("is its newest reply, secrets redacted, with the message and conversation it came from", () => {
    const snapshot = buildSnapshot(input({ bots: [bot("lead", [
      thread("old", { reply: { messageId: "m1", text: "Old news", at: 1 } }),
      thread("new", { reply: { messageId: "m2", text: `Episode 1 is drafted. Key: ${KEY}`, at: 9 } }),
    ])] }));
    expect(snapshot.bots.lead!.output).toEqual({ text: expect.stringContaining("Episode 1 is drafted. Key: «redacted"), threadId: "new", messageId: "m2", at: 9 });
    expect(snapshot.bots.lead!.output!.text).not.toContain(KEY);
  });

  it("is cut at the limit and says so", () => {
    const long = "镜".repeat(CANVAS_OUTPUT_MAX_CHARS + 10);
    const output = buildSnapshot(input({ bots: [bot("lead", [thread("a", { reply: { messageId: "m", text: long, at: 1 } })])] })).bots.lead!.output!;
    expect([...output.text]).toHaveLength(CANVAS_OUTPUT_MAX_CHARS);
    expect(output.truncated).toBe(true);
  });

  it("holds nothing from a conversation the viewer may not open", () => {
    const threads = [
      thread("shared", { reply: { messageId: "m1", text: "Shared draft", at: 1 } }),
      thread("private", { busy: true, doing: "Reading secret plan.md", reply: { messageId: "m2", text: "Private draft", at: 9 }, card: { messageId: "m3", at: 9, card } }),
    ];
    const hidden = buildSnapshot(input({ bots: [bot("lead", threads)], sees: (threadId) => threadId !== "private" })).bots.lead!;
    expect(hidden.output).toMatchObject({ text: "Shared draft", threadId: "shared" });
    expect(hidden).not.toHaveProperty("doing");
    expect(hidden).not.toHaveProperty("waiting");
    expect(hidden.status).toBe("waiting");
    const none = buildSnapshot(input({ bots: [bot("lead", threads)], sees: () => false })).bots.lead!;
    expect(none).not.toHaveProperty("output");
  });

  it("carries what it is doing while it works and the card it waits with, redacted", () => {
    const state = buildSnapshot(input({ bots: [bot("lead", [
      thread("a", { busy: true, doing: "Ran pnpm test" }),
      thread("b", { card: { messageId: "m3", at: 4, card } }),
    ])] })).bots.lead!;
    expect(state.doing).toBe("Ran pnpm test");
    expect(state.waiting).toMatchObject({ threadId: "b", messageId: "m3", card: { title: "Run a command?" } });
    expect(JSON.stringify(state.waiting)).not.toContain(KEY);
  });
});

describe("the project around the canvas", () => {
  it("says when the canvas takes no change", () => {
    const archived = buildSnapshot(input({ project: { id: "p1", name: "Stand-in bride", leadBotId: "lead", archived: true, folderState: "missing" } }));
    expect(archived.readOnly).toBe("archived");
    expect(archived.project.folderState).toBe("missing");
    expect(buildSnapshot(input())).not.toHaveProperty("readOnly");
  });
});
