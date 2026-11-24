import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CANVAS_TEXT_MAX_HEIGHT, type CanvasDocument, type CanvasNodeCreator, type CanvasOp } from "../../shared/project-canvas.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import { CanvasConflictError, CanvasDocuments, CanvasUnreadableError, CANVAS_HISTORY, type RemovedNode } from "./document-store.ts";
import { applyCanvasOps, opTargets } from "./ops.ts";

let dir: string;
let logged: string[];

const store = () => new CanvasDocuments(dir, (line) => logged.push(line));
const file = (projectId = "p1") => join(dir, `${projectId}.json`);

function change(documents: CanvasDocuments, ops: CanvasOp[], baseRevision?: number, projectId = "p1", actor: CanvasNodeCreator = { kind: "person" }) {
  let n = 0;
  return documents.change(projectId, {
    ...(baseRevision === undefined ? {} : { baseRevision }),
    targets: opTargets(ops),
    apply: (document: CanvasDocument, removed) => applyCanvasOps(document, ops, {
      actor, bots: new Map(), newId: () => `n${document.revision}-${++n}`, place: () => ({ x: 0, y: 0 }), removed,
    }),
  });
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-canvas-store-"));
  logged = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a project's canvas on disk", () => {
  it("reads as an empty canvas at revision 0 before any change, and writes nothing for that", () => {
    expect(store().read("p1")).toEqual({ projectId: "p1", revision: 0, nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" });
    expect(existsSync(file())).toBe(false);
  });

  it("reads a text node stored taller than a text node may be at the tallest it may be, and any other node as stored", () => {
    change(store(), [{ type: "add_node", id: "long", nodeType: "text" }, { type: "add_node", id: "tall", nodeType: "image" }]);
    const stored = JSON.parse(readFileSync(file(), "utf8")) as { document: CanvasDocument };
    stored.document.nodes = stored.document.nodes.map((node) => ({ ...node, height: 1_500 }));
    writeFileSync(file(), JSON.stringify(stored));
    expect(store().read("p1").nodes.map((node) => [node.id, node.height])).toEqual([["long", CANVAS_TEXT_MAX_HEIGHT], ["tall", 1_500]]);
  });

  it("raises the revision with each change and keeps it across a restart, readable by its owner only", () => {
    const documents = store();
    expect(change(documents, [{ type: "add_node", id: "brief", nodeType: "text" }]).revision).toBe(1);
    expect(change(documents, [{ type: "update_node", id: "brief", patch: { title: "Brief" } }]).revision).toBe(2);
    expect(documents.revisionOf("p1")).toBe(2);
    expect(store().revisionOf("p2")).toBe(0);
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    const again = store().read("p1");
    expect(again.revision).toBe(2);
    expect(again.nodes.map((node) => node.title)).toEqual(["Brief"]);
  });

  it("keeps across a restart that the person moved a node", () => {
    change(store(), [{ type: "add_node", id: "brief", nodeType: "text" }]);
    change(store(), [{ type: "update_node", id: "brief", patch: { position: { x: 40, y: 80 } } }]);
    expect(store().read("p1").nodes[0]).toMatchObject({ position: { x: 40, y: 80 }, arranged: true });
  });

  it("keeps the revision when nothing changed", () => {
    const documents = store();
    change(documents, [{ type: "add_node", id: "a", nodeType: "text" }, { type: "add_node", id: "b", nodeType: "text" }, { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" }]);
    const before = readFileSync(file(), "utf8");
    const outcome = change(documents, [{ type: "connect_nodes", fromNodeId: "a", toNodeId: "b" }]);
    expect(outcome.revision).toBe(1);
    expect(outcome.connectionIds).toHaveLength(1);
    expect(readFileSync(file(), "utf8")).toBe(before);
  });

  it("refuses a project id that is not a plain name", () => {
    expect(thrown(() => store().read("../p1"))).toMatchObject({ status: 404 });
  });
});

describe("a canvas read", () => {
  const brief: CanvasOp = { type: "add_node", id: "brief", nodeType: "text", title: "Brief", metadata: { content: "The swap." } };
  const attempts = (read: CanvasDocument) => [
    () => read.nodes.push({ ...read.nodes[0]! }),
    () => { read.nodes[0]!.title = "Theirs"; },
    () => { read.nodes[0]!.metadata!.content = "Theirs"; },
    () => { read.nodes[0]!.position.x = 9; },
    () => { read.viewport.k = 2; },
    () => { read.revision = 7; },
  ];

  it("is the canvas as stored, which a reader cannot change, read from disk or after a change", () => {
    const documents = store();
    change(documents, [brief]);
    for (const read of [documents.read("p1"), store().read("p1")]) {
      for (const attempt of attempts(read)) expect(attempt).toThrow(TypeError);
    }
    expect(documents.read("p1")).toMatchObject({ revision: 1, viewport: { k: 1 }, nodes: [{ id: "brief", title: "Brief", position: { x: 0, y: 0 }, metadata: { content: "The swap." } }] });
    expect(documents.read("p1").nodes).toHaveLength(1);
  });

  it("stays as it was when the canvas changes after it, while a change works on a copy of its own and hands back one", () => {
    const documents = store();
    change(documents, [brief]);
    const before = documents.read("p1");
    const outcome = change(documents, [{ type: "update_node", id: "brief", patch: { title: "Mine" } }]);
    expect([before.revision, before.nodes[0]!.title]).toEqual([1, "Brief"]);
    outcome.document.nodes[0]!.title = "The caller's";
    expect(documents.read("p1")).toMatchObject({ revision: 2, nodes: [{ title: "Mine" }] });
  });
});

describe("a change made against an old revision", () => {
  function twoNodes() {
    const documents = store();
    change(documents, [{ type: "add_node", id: "brief", nodeType: "text" }, { type: "add_node", id: "cover", nodeType: "image" }]);
    return documents;
  }

  it("is merged when what it touches did not change since", () => {
    const documents = twoNodes();
    change(documents, [{ type: "update_node", id: "cover", patch: { title: "Cover" } }]);
    const merged = change(documents, [{ type: "update_node", id: "brief", patch: { title: "Brief" } }], 1);
    expect(merged.revision).toBe(3);
    expect(documents.read("p1").nodes.map((node) => node.title)).toEqual(["Brief", "Cover"]);
  });

  it("is refused whole when it touches a node that changed since, naming what changed", () => {
    const documents = twoNodes();
    change(documents, [{ type: "update_node", id: "brief", patch: { title: "Theirs" } }]);
    change(documents, [{ type: "delete_node", id: "cover" }]);
    const conflict = thrown(() => change(documents, [
      { type: "update_node", id: "brief", patch: { title: "Mine" } },
      { type: "update_node", id: "cover", patch: { title: "Mine" } },
    ], 1));
    expect(conflict).toBeInstanceOf(CanvasConflictError);
    expect((conflict as CanvasConflictError).body).toMatchObject({ code: "canvas_conflict", revision: 3, changed: { nodes: ["brief", "cover"], connections: [] } });
    expect(documents.read("p1").nodes.map((node) => node.title)).toEqual(["Theirs"]);
  });

  it("is refused as stale when it is older than the history kept, and as wrong when it is newer than the canvas", () => {
    const documents = twoNodes();
    for (let i = 0; i < CANVAS_HISTORY + 1; i += 1) change(documents, [{ type: "set_viewport", viewport: { x: i, y: 0, k: 1 } }]);
    expect((thrown(() => change(documents, [{ type: "update_node", id: "brief", patch: { title: "x" } }], 1)) as CanvasConflictError).body.code).toBe("canvas_stale");
    expect(thrown(() => change(documents, [{ type: "update_node", id: "brief", patch: { title: "x" } }], 999))).toMatchObject({ status: 400 });
    const kept = JSON.parse(readFileSync(file(), "utf8")) as { history: unknown[] };
    expect(kept.history).toHaveLength(CANVAS_HISTORY);
  });
});

describe("a deleted node", () => {
  const writer: CanvasNodeCreator = { kind: "bot", botId: "writer" };
  const shot: CanvasOp = { type: "add_node", id: "shot-1", nodeType: "shot" };
  const remove: CanvasOp = { type: "delete_node", id: "shot-1" };
  const makerOf = (documents: CanvasDocuments) => documents.read("p1").nodes.find((node) => node.id === "shot-1")?.createdBy;
  const removedKept = () => (JSON.parse(readFileSync(file(), "utf8")) as { removed: RemovedNode[] }).removed;

  it("comes back as its maker's when the person adds it back, after a restart too, and is then no longer kept as deleted", () => {
    const documents = store();
    change(documents, [shot], undefined, "p1", writer);
    change(documents, [remove]);
    expect(removedKept()).toEqual([{ revision: 2, id: "shot-1", type: "shot", createdBy: writer }]);
    const restarted = store();
    change(restarted, [shot]);
    expect(makerOf(restarted)).toEqual(writer);
    expect(removedKept()).toEqual([]);
  });

  it("comes back as the person's once it is older than the history kept", () => {
    const documents = store();
    change(documents, [shot], undefined, "p1", writer);
    change(documents, [remove]);
    for (let i = 0; i < CANVAS_HISTORY; i += 1) change(documents, [{ type: "set_viewport", viewport: { x: i, y: 0, k: 1 } }]);
    change(documents, [shot]);
    expect(makerOf(documents)).toEqual({ kind: "person" });
  });

  it("reads from a file kept before deleted nodes were", () => {
    writeFileSync(file(), JSON.stringify({ version: 1, document: { projectId: "p1", revision: 3, nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" }, history: [] }));
    const documents = store();
    expect(documents.read("p1").revision).toBe(3);
    change(documents, [shot]);
    expect(makerOf(documents)).toEqual({ kind: "person" });
  });
});

describe("what the pipeline keeps with a canvas", () => {
  const serverChange = (documents: CanvasDocuments, make: (document: CanvasDocument) => { nodes?: string[]; connections?: string[] }, stages?: Record<string, FlowStage[]>) =>
    documents.change("p1", {
      targets: { nodes: [], connections: [] },
      apply: (document) => {
        const changed = make(document);
        return { document, changed: { nodes: changed.nodes ?? [], connections: changed.connections ?? [] }, nodeIds: [], connectionIds: [], ...(stages ? { stages } : {}) };
      },
    });

  it("keeps a connection the server made for the pipeline as one across a restart", () => {
    const documents = store();
    change(documents, [{ type: "add_node", id: "shot-1", nodeType: "shot" }, { type: "add_node", id: "make-1", nodeType: "config" }]);
    serverChange(documents, (document) => {
      document.connections.push({ id: "link", fromNodeId: "shot-1", toNodeId: "make-1", kind: "content", pipeline: true });
      return { connections: ["link"] };
    });
    expect(store().read("p1").connections).toEqual([{ id: "link", fromNodeId: "shot-1", toNodeId: "make-1", kind: "content", pipeline: true }]);
  });

  it("has no stages on a canvas stored before the pipeline, and keeps the ones its links were made for", () => {
    const documents = store();
    change(documents, [{ type: "add_node", id: "brief", nodeType: "text" }]);
    expect(documents.stagesOf("p1")).toBeUndefined();
    const stages: Record<string, FlowStage[]> = { lead: ["lead"], boards: ["character", "storyboard"] };
    expect(serverChange(documents, () => ({}), stages).revision).toBe(1);
    expect(documents.stagesOf("p1")).toEqual(stages);
    expect(store().stagesOf("p1")).toEqual(stages);
    expect(store().read("p1").revision).toBe(1);
  });

  it("writes nothing when neither the canvas nor the stages changed", () => {
    const documents = store();
    serverChange(documents, () => ({}), { lead: ["lead"] });
    rmSync(file());
    serverChange(documents, () => ({}), { lead: ["lead"] });
    expect(existsSync(file())).toBe(false);
  });

  it("keeps what a deleted node was in the pipeline, for the person adding it back", () => {
    const documents = store();
    change(documents, [{ type: "add_node", id: "take-1", nodeType: "video" }, { type: "add_node", id: "clip", nodeType: "video" }]);
    serverChange(documents, (document) => {
      document.nodes[0]!.metadata = { role: "take", shotId: "shot-1", selected: true, stale: true };
      return { nodes: ["take-1"] };
    });
    let kept: RemovedNode | undefined;
    documents.change("p1", {
      targets: { nodes: ["take-1", "clip"], connections: [] },
      apply: (document) => ({ document: { ...document, nodes: [] }, changed: { nodes: ["take-1", "clip"], connections: [] }, nodeIds: [], connectionIds: [] }),
    });
    store().change("p1", { targets: { nodes: [], connections: [] }, apply: (document, removed) => {
      kept = removed("take-1");
      expect(removed("clip")).not.toHaveProperty("pipeline");
      return { document, changed: { nodes: [], connections: [] }, nodeIds: [], connectionIds: [] };
    } });
    expect(kept).toEqual({ revision: 3, id: "take-1", type: "video", createdBy: { kind: "person" }, pipeline: { role: "take", shotId: "shot-1", selected: true } });
  });
});

describe("a canvas file that cannot be read", () => {
  it.each([
    ["not JSON", "{ nodes: ["],
    ["not a canvas", JSON.stringify({ version: 1, document: { nodes: "many" } })],
  ])("is never written over (%s): reads and changes are refused and it stays as it is", (reason, text) => {
    writeFileSync(file(), text);
    const documents = store();
    expect(thrown(() => documents.read("p1"))).toBeInstanceOf(CanvasUnreadableError);
    expect(thrown(() => change(documents, [{ type: "add_node", nodeType: "text" }]))).toBeInstanceOf(CanvasUnreadableError);
    expect(documents.revisionOf("p1")).toBeNull();
    expect(readFileSync(file(), "utf8")).toBe(text);
    expect(logged).toEqual([`[project-canvas] p1: the canvas file could not be read (${reason}); it is left as it is`]);
  });

  it("reads again once the file is put back", () => {
    const documents = store();
    change(documents, [{ type: "add_node", id: "brief", nodeType: "text" }]);
    const good = readFileSync(file(), "utf8");
    const fresh = store();
    writeFileSync(file(), "broken");
    expect(thrown(() => fresh.read("p1"))).toBeInstanceOf(CanvasUnreadableError);
    writeFileSync(file(), good);
    expect(fresh.read("p1").nodes).toHaveLength(1);
  });
});
