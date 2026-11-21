import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CanvasDocument, CanvasOp } from "../../shared/project-canvas.ts";
import { CanvasConflictError, CanvasDocuments, CanvasUnreadableError, CANVAS_HISTORY } from "./document-store.ts";
import { applyCanvasOps, opTargets } from "./ops.ts";

let dir: string;
let logged: string[];

const store = () => new CanvasDocuments(dir, (line) => logged.push(line));
const file = (projectId = "p1") => join(dir, `${projectId}.json`);

function change(documents: CanvasDocuments, ops: CanvasOp[], baseRevision?: number, projectId = "p1") {
  let n = 0;
  return documents.change(projectId, {
    ...(baseRevision === undefined ? {} : { baseRevision }),
    targets: opTargets(ops),
    apply: (document: CanvasDocument) => applyCanvasOps(document, ops, {
      actor: { kind: "person" }, bots: new Map(), newId: () => `n${document.revision}-${++n}`, place: () => ({ x: 0, y: 0 }),
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
