import { describe, expect, it } from "vitest";

import type { JianyingInstall } from "./jianying.ts";
import { launchJianying, startDetached } from "./open.ts";

const MAC: JianyingInstall = { version: "11.8.0", app: "/Applications/VideoFusion-macOS.app", bundleId: "com.lemon.lvpro", draftRoot: "/drafts", timelineFile: "draft_info.json" };
const WINDOWS: JianyingInstall = { version: "11.8.0.1", app: "C:\\Users\\me\\AppData\\Local\\JianyingPro\\Apps\\JianyingPro.exe", draftRoot: "C:\\drafts", timelineFile: "draft_content.json" };
const SERVER_ENV = {
  PATH: "/usr/bin:/bin", HOME: "/Users/me", USER: "me", LANG: "zh_CN.UTF-8", TMPDIR: "/tmp/x",
  ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "--max-old-space-size=4096", OMB_DESKTOP_PARENT: "1", OMB_COMMS_TOKEN: "secret", ANTHROPIC_API_KEY: "sk-secret",
};

function recorder(answer = true) {
  const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = [];
  return { calls, start: async (command: string, args: string[], env: Record<string, string>) => { calls.push({ command, args, env }); return answer; } };
}

describe("bringing JianYing to the front", () => {
  it("opens the app on a Mac the way Finder does, with none of the server's own environment", async () => {
    const { calls, start } = recorder();
    expect(await launchJianying(MAC, { platform: "darwin", env: SERVER_ENV, start })).toBe(true);
    expect(calls).toEqual([{ command: "/usr/bin/open", args: ["-a", "/Applications/VideoFusion-macOS.app"], env: { PATH: "/usr/bin:/bin", HOME: "/Users/me", USER: "me", LANG: "zh_CN.UTF-8", TMPDIR: "/tmp/x" } }]);
  });

  it("starts the launcher on Windows with the system's variables and nothing of the server's", async () => {
    const { calls, start } = recorder();
    const env = { SystemRoot: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", USERPROFILE: "C:\\Users\\me", Path: "C:\\Windows\\system32", ELECTRON_RUN_AS_NODE: "1", OMB_DATA_DIR: "D:\\data" };
    expect(await launchJianying(WINDOWS, { platform: "win32", env, start })).toBe(true);
    expect(calls).toEqual([{ command: WINDOWS.app, args: [], env: { SystemRoot: "C:\\Windows", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", USERPROFILE: "C:\\Users\\me", Path: "C:\\Windows\\system32" } }]);
  });

  it("says when JianYing did not start, and starts nothing on a system it has no app for", async () => {
    expect(await launchJianying(MAC, { platform: "darwin", env: SERVER_ENV, start: recorder(false).start })).toBe(false);
    const { calls, start } = recorder();
    expect(await launchJianying(MAC, { platform: "linux", env: SERVER_ENV, start })).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("starting a program apart from the server", () => {
  const node = process.execPath;

  it("is true for a program that starts and ends well, and gives it only the environment it is handed", async () => {
    expect(await startDetached(node, ["-e", "process.exit(process.env.ELECTRON_RUN_AS_NODE || process.env.OMB_SECRET ? 3 : 0)"], { PATH: process.env.PATH ?? "" })).toBe(true);
  });

  it("is false for a program that ends badly or is not there", async () => {
    expect(await startDetached(node, ["-e", "process.exit(3)"], { PATH: process.env.PATH ?? "" })).toBe(false);
    expect(await startDetached("/no/such/program/anywhere", [], {})).toBe(false);
  });

  it("is true for a program still running after the wait, and leaves it running", async () => {
    expect(await startDetached(node, ["-e", "setTimeout(() => {}, 400)"], { PATH: process.env.PATH ?? "" }, 100)).toBe(true);
  });
});
