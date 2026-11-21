import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { onTeamProjectFolderChange, ProjectFolderStates, watchProjectFolders, type FolderChange } from "./folder-watch.ts";

describe("the project folders as last seen", () => {
  it("says nothing of a folder first seen there, then tells each time it goes missing or comes back", async () => {
    const there = new Map([["/dramas/bride", true], ["/dramas/heir", true]]);
    const states = new ProjectFolderStates(async (folder) => (there.get(folder) ? "ready" : "missing"));
    const projects = [{ id: "p1", folder: "/dramas/bride" }, { id: "p2", folder: "/dramas/heir" }];
    expect(await states.look(projects)).toEqual([]);
    there.set("/dramas/heir", false);
    expect(await states.look(projects)).toEqual([{ projectId: "p2", folderState: "missing" }]);
    expect(await states.look(projects)).toEqual([]);
    there.set("/dramas/heir", true);
    expect(await states.look(projects)).toEqual([{ projectId: "p2", folderState: "ready" }]);
  });

  it("tells of a folder already missing on its project's first look, as the list read before showed it there", async () => {
    const states = new ProjectFolderStates(async (folder) => (folder === "/dramas/heir" ? "missing" : "ready"));
    expect(await states.look([{ id: "p1", folder: "/dramas/bride" }, { id: "p2", folder: "/dramas/heir" }]))
      .toEqual([{ projectId: "p2", folderState: "missing" }]);
  });

  it("forgets a project that left the list, so its return is a first look again", async () => {
    let ready = false;
    const states = new ProjectFolderStates(async () => (ready ? "ready" : "missing"));
    expect(await states.look([{ id: "p1", folder: "/dramas/bride" }])).toEqual([{ projectId: "p1", folderState: "missing" }]);
    await states.look([]);
    ready = true;
    expect(await states.look([{ id: "p1", folder: "/dramas/bride" }])).toEqual([]);
  });

  it("looks at one folder at a time", async () => {
    let open = 0, most = 0;
    const states = new ProjectFolderStates(async () => {
      most = Math.max(most, ++open);
      await new Promise((done) => setTimeout(done, 1));
      open -= 1;
      return "ready";
    });
    await states.look([{ id: "p1", folder: "/a" }, { id: "p2", folder: "/b" }, { id: "p3", folder: "/c" }]);
    expect(most).toBe(1);
  });
});

describe("watching the project folders", () => {
  const stops: Array<() => void> = [];
  const roots: string[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("tells the listeners within a moment when a folder goes missing and when it comes back", async () => {
    const root = mkdtempSync(join(tmpdir(), "omb-folder-watch-"));
    roots.push(root);
    const folder = join(root, "drama"), away = join(root, "unplugged");
    mkdirSync(folder);
    const heard: FolderChange[] = [];
    stops.push(onTeamProjectFolderChange((change) => heard.push(change)));
    stops.push(watchProjectFolders(() => [{ id: "p1", folder }], 20));
    await new Promise((done) => setTimeout(done, 60));
    expect(heard).toEqual([]);
    renameSync(folder, away);
    await vi.waitFor(() => expect(heard).toEqual([{ projectId: "p1", folderState: "missing" }]), { timeout: 2000 });
    renameSync(away, folder);
    await vi.waitFor(() => expect(heard).toEqual([{ projectId: "p1", folderState: "missing" }, { projectId: "p1", folderState: "ready" }]), { timeout: 2000 });
  });

  it("keeps watching after a look that failed", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const heard: FolderChange[] = [];
    stops.push(onTeamProjectFolderChange((change) => heard.push(change)));
    let ready = true;
    stops.push(watchProjectFolders(() => {
      if (fail) throw new Error("/Users/me/dramas cannot be read");
      return [{ id: "p1", folder: "/dramas/bride" }];
    }, 20, new ProjectFolderStates(async () => (ready ? "ready" : "missing"))));
    await vi.waitFor(() => expect(errors).toHaveBeenCalled(), { timeout: 2000 });
    expect(String(errors.mock.calls[0]![0])).not.toContain("/Users/me");
    fail = false;
    await new Promise((done) => setTimeout(done, 60));
    ready = false;
    await vi.waitFor(() => expect(heard).toEqual([{ projectId: "p1", folderState: "missing" }]), { timeout: 2000 });
    errors.mockRestore();
  });
});
