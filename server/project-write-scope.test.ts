import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acpWritePaths, leavesProject, placeAllowed, projectWriteScope, projectWriteVerdict, shellWriteTargets, writeToolPaths, type ProjectWriteScope } from "./project-write-scope.ts";

let root: string;
let project: string;
let data: string;
let scope: ProjectWriteScope;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "project-write-scope-"));
  project = join(root, "drama");
  data = join(root, "data");
  mkdirSync(join(project, ".magic-team", "bots", "writer"), { recursive: true });
  mkdirSync(data);
  scope = { folder: project, exempt: [join(data, "workspaces", "bot-writer"), join(data, "task-workspaces", "bot-writer")] };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const toolWrite = (tool: string, input: Record<string, unknown>) => projectWriteVerdict(scope, { writes: writeToolPaths(tool, input) });
const shell = (command: string, cwd = project) => projectWriteVerdict(scope, { command: { command, cwd } });

describe("a project bot's writes", () => {
  it("lets the project folder and everything below it through, .magic-team and its own folder included", () => {
    expect(toolWrite("Write", { file_path: join(project, "bible.md"), content: "x" })).toBe("inside");
    expect(toolWrite("Edit", { file_path: join(project, "docs", "s1", "scene.md") })).toBe("inside");
    expect(toolWrite("MultiEdit", { file_path: join(project, ".magic-team", "bots", "writer", "MEMORY.md") })).toBe("inside");
    expect(toolWrite("NotebookEdit", { notebook_path: join(project, "nb.ipynb") })).toBe("inside");
    expect(toolWrite("mcp__computer__write_file", { path: join(project, "out.png") })).toBe("inside");
    expect(toolWrite("computer_make_folder", { path: join(root, "out") })).toBe("outside");
    expect(writeToolPaths("shared_computer", { action: "write_file", path: "x" })).toBeUndefined();
  });

  it("holds a write that climbs out with .. and one that names another folder", () => {
    expect(toolWrite("Write", { file_path: join(project, "..", "escape.md") })).toBe("outside");
    expect(toolWrite("Write", { file_path: join(project, "docs", "..", "..", "escape.md") })).toBe("outside");
    expect(toolWrite("Write", { file_path: join(root, "elsewhere", "x.md") })).toBe("outside");
    expect(toolWrite("Write", { file_path: "/home/oai/share/dao_medical_visual_bible.md" })).toBe("outside");
    expect(toolWrite("Write", { file_path: join(homedir(), "Desktop", "x.md") })).toBe("outside");
  });

  it("holds a write through a link that leads out, and lets through one that leads in", () => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(project, "linked"));
    expect(toolWrite("Write", { file_path: join(project, "linked", "x.md") })).toBe("outside");
    const inner = join(project, "real");
    mkdirSync(inner);
    symlinkSync(inner, join(project, "shortcut"));
    expect(toolWrite("Write", { file_path: join(project, "shortcut", "x.md") })).toBe("inside");
    // A link retargeted from inside to outside between two writes is read again, not remembered.
    rmSync(join(project, "linked"));
    symlinkSync(inner, join(project, "linked"));
    expect(toolWrite("Write", { file_path: join(project, "linked", "x.md") })).toBe("inside");
  });

  it("takes a temp folder and the bot's own private folders as they were", () => {
    const real = projectWriteScope("/opt/omb-fixture-project", data, "bot-writer");
    expect(projectWriteVerdict(real, { writes: [join(tmpdir(), "omb-scratch", "x.md")] })).toBe("inside");
    expect(projectWriteVerdict(real, { writes: ["/tmp/x.md"] })).toBe("inside");
    expect(projectWriteVerdict(real, { command: { command: "cd /tmp && touch x.md", cwd: project } })).toBe("inside");
    expect(projectWriteVerdict(real, { command: { command: "echo hi > /dev/null", cwd: project } })).toBe("inside");
    expect(projectWriteVerdict(real, { writes: ["/etc/hosts"] })).toBe("outside");
    expect(toolWrite("Write", { file_path: join(data, "workspaces", "bot-writer", "MEMORY.md") })).toBe("inside");
    expect(toolWrite("Write", { file_path: join(data, "workspaces", "bot-editor", "MEMORY.md") })).toBe("outside");
    expect(toolWrite("Write", { file_path: join(data, "attachments", "x.png") })).toBe("outside");
  });

  it("does not take the temp root that holds the project as a place of its own", () => {
    const real = projectWriteScope(project, data, "bot-writer");
    expect(real.exempt).not.toContain(tmpdir());
    expect(projectWriteVerdict(real, { writes: [join(root, "sibling", "x.md")] })).toBe("outside");
  });

  it("asks, rather than lets through, a write whose place cannot be read", () => {
    expect(toolWrite("Write", {})).toBe("unknown");
    expect(toolWrite("Write", { file_path: "relative/x.md" })).toBe("unknown");
    expect(projectWriteVerdict(scope, { writes: [] })).toBe("unknown");
    expect(projectWriteVerdict(scope, { writes: undefined })).toBe("not-a-write");
  });

  it("reads a shell line for the places it writes, not the ones it reads", () => {
    expect(shell("echo hi > note.md")).toBe("inside");
    expect(shell("echo hi >> docs/note.md")).toBe("inside");
    expect(shell("cp assets/logo.png out/logo.png")).toBe("inside");
    expect(shell("mkdir -p docs/scenes")).toBe("inside");
    expect(shell("touch a.md b.md")).toBe("inside");
    expect(shell("ls -la && cat README.md")).toBe("not-a-write");
    expect(shell("cat /etc/hosts > copy.txt")).toBe("inside");
    expect(shell("cp /Users/someone/Downloads/logo.png assets/logo.png")).toBe("inside");
    expect(shell("node build.js")).toBe("not-a-write");
  });

  it("holds a shell write that lands outside, by path, by .. or by a folder it moved to", () => {
    expect(shell("echo hi > /etc/passwd")).toBe("outside");
    expect(shell("echo hi>../escape.md")).toBe("outside");
    expect(shell("cp out.md ../../escape.md")).toBe("outside");
    expect(shell("cd .. && touch escape.md")).toBe("outside");
    expect(shell("cd docs && touch ../inside.md")).toBe("inside");
    expect(shell("mkdir -p ~/Desktop/out")).toBe("outside");
    expect(shell('echo hi > "$HOME/Desktop/out.md"')).toBe("outside");
    expect(shell(`tee ${join(root, "x.md")} < in.md`)).toBe("outside");
  });

  it("asks for a shell write that goes through a variable", () => {
    expect(shell('echo hi > "$OUT/x.md"')).toBe("unknown");
    expect(shell("cd $OUT && touch x.md")).toBe("unknown");
  });

  it("reads a shell line whose folder is unknown as unknown when it writes", () => {
    expect(projectWriteVerdict(scope, { commandLine: "echo hi > out.md" })).toBe("unknown");
    expect(projectWriteVerdict(scope, { commandLine: "ls -la" })).toBe("not-a-write");
    expect(projectWriteVerdict(scope, {})).toBe("not-a-write");
  });

  it("names the places shell writers take, and nothing for a command that is not one", () => {
    expect(shellWriteTargets("tee a.md b.md")).toEqual([{ path: "a.md", cwd: null }, { path: "b.md", cwd: null }]);
    expect(shellWriteTargets("cp -r src/ out/")).toEqual([{ path: "out/", cwd: null }]);
    expect(shellWriteTargets("cp -t /elsewhere a.md")).toEqual([{ path: "/elsewhere", cwd: null }]);
    expect(shellWriteTargets("install -m 644 a.md dest/")).toEqual([{ path: "dest/", cwd: null }]);
    expect(shell(`mv ${join(root, "theirs.md")} here.md`)).toBe("outside");
    expect(shellWriteTargets("sed -i s/a/b/ x.md")).toBeNull();
    expect(shellWriteTargets("echo x 2>&1")).toBeNull();
  });

  it("reads ACP's edit, delete and move places, and nothing for a read", () => {
    expect(acpWritePaths({ kind: "edit", locations: [{ path: join(project, "a.md") }] })).toEqual([join(project, "a.md")]);
    expect(acpWritePaths({ kind: "move", locations: [{ path: join(project, "a.md") }, { path: join(root, "b.md") }] })).toEqual([join(project, "a.md"), join(root, "b.md")]);
    expect(acpWritePaths({ kind: "read", locations: [{ path: "/etc/hosts" }] })).toBeUndefined();
    expect(acpWritePaths({ kind: "edit", rawInput: { filePath: join(root, "x.md") } })).toEqual([join(root, "x.md")]);
    expect(acpWritePaths({ kind: "edit" })).toEqual([""]);
    expect(projectWriteVerdict(scope, { writes: acpWritePaths({ kind: "edit", rawInput: { filePath: join(root, "x.md") } }) })).toBe("outside");
  });

  it("carries a path inside a link chain no further than its real place", () => {
    writeFileSync(join(project, "a.md"), "x");
    expect(placeAllowed(scope, "a.md", project)).toBe(true);
    expect(placeAllowed(scope, join(root, "missing", "x.md"), project)).toBe(false);
    expect(leavesProject("outside")).toBe(true);
    expect(leavesProject("unknown")).toBe(true);
    expect(leavesProject("inside")).toBe(false);
  });
});
