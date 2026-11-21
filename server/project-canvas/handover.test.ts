import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CanvasDocument, CanvasNode } from "../../shared/project-canvas.ts";
import { handOver } from "./handover.ts";

let dir: string;
let project: string;
let attachments: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "omb-canvas-handover-")));
  project = join(dir, "Stand-in bride");
  attachments = join(dir, "attachments");
  mkdirSync(join(project, "剧本"), { recursive: true });
  mkdirSync(attachments);
  writeFileSync(join(project, "剧本", "episode-1.md"), "# Episode 1");
  writeFileSync(join(attachments, "copy-1.md"), "# Episode 1");
  writeFileSync(join(dir, "poster.png"), "poster bytes");
  writeFileSync(join(attachments, "copy-2.png"), "poster bytes");
  writeFileSync(join(attachments, "copy-3.png"), "poster bytes");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function canvas(nodes: CanvasNode[] = []): CanvasDocument {
  return { projectId: "p1", revision: 1, nodes, connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots" };
}

function fileNode(id: string, patch: { path: string; mime: string; bytes: number; name: string }): CanvasNode {
  return { id, type: "file", title: patch.name, position: { x: 0, y: 0 }, width: 340, height: 120, metadata: { file: patch } };
}

describe("a file a bot attaches", () => {
  it("is referenced where it is when it is in the project folder, and only once", async () => {
    const attached = { path: join(attachments, "copy-1.md"), mime: "text/markdown; charset=utf-8", name: "episode-1.md", source: join(project, "剧本", "episode-1.md") };
    const first = await handOver(canvas(), project, attached);
    expect(first).toEqual({ add: { nodeType: "file", title: "episode-1.md", file: { path: "剧本/episode-1.md", mime: "text/markdown; charset=utf-8", bytes: 11, name: "episode-1.md" } } });
    const again = await handOver(canvas([fileNode("n1", { path: "剧本/episode-1.md", mime: "text/markdown", bytes: 11, name: "episode-1.md" })]), project, attached);
    expect(again).toEqual({ existing: "n1" });
  });

  it("is copied into 产出 when it is elsewhere, and the same bytes again make no second copy", async () => {
    const first = await handOver(canvas(), project, { path: join(attachments, "copy-2.png"), mime: "image/png", name: "poster.png", source: join(dir, "poster.png") });
    expect(first).toEqual({ add: { nodeType: "image", title: "poster.png", file: { path: "产出/poster.png", mime: "image/png", bytes: 12, name: "poster.png" } } });
    expect(readFileSync(join(project, "产出", "poster.png"), "utf8")).toBe("poster bytes");
    const placed = canvas([{ ...fileNode("img", { path: "产出/poster.png", mime: "image/png", bytes: 12, name: "poster.png" }), type: "image" }]);
    expect(await handOver(placed, project, { path: join(attachments, "copy-3.png"), mime: "image/png", name: "poster.png", source: join(dir, "poster.png") })).toEqual({ existing: "img" });
  });

  it("is copied when it is reached through a link that leads out, under a name of its own", async () => {
    mkdirSync(join(project, "产出"));
    writeFileSync(join(project, "产出", "poster.png"), "another poster");
    symlinkSync(join(dir, "poster.png"), join(project, "剧本", "poster-link.png"));
    const outcome = await handOver(canvas(), project, { path: join(attachments, "copy-2.png"), mime: "image/png", name: "poster.png", source: join(project, "剧本", "poster-link.png") });
    expect(outcome).toMatchObject({ add: { file: { path: "产出/poster-2.png" } } });
    expect(existsSync(join(project, "剧本", "poster-link.png"))).toBe(true);
  });

  it("is refused when the project folder is missing", async () => {
    await expect(handOver(canvas(), join(dir, "gone"), { path: join(attachments, "copy-2.png"), mime: "image/png", source: join(dir, "poster.png") })).rejects.toMatchObject({ code: "folder_missing" });
  });
});
