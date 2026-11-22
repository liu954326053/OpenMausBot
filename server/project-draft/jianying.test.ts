import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultJianyingPlaces, findJianying, type JianyingPlaces } from "./jianying.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const plist = (version: string) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.lemon.lvpro</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
</dict></plist>`;

function mac(options: { version?: string | null; draftFolder?: boolean; setting?: string } = {}) {
  const base = mkdtempSync(join(tmpdir(), "omb-jianying-"));
  dirs.push(base);
  const home = join(base, "home");
  const applications = join(base, "Applications");
  const app = join(applications, "VideoFusion-macOS.app");
  const userData = join(home, "Movies", "JianyingPro", "User Data");
  const drafts = join(userData, "Projects", "com.lveditor.draft");
  mkdirSync(home, { recursive: true });
  if (options.version !== null) {
    mkdirSync(join(app, "Contents"), { recursive: true });
    writeFileSync(join(app, "Contents", "Info.plist"), plist(options.version ?? "11.8.0"));
  }
  if (options.draftFolder !== false) mkdirSync(drafts, { recursive: true });
  if (options.setting !== undefined) {
    mkdirSync(join(userData, "Config"), { recursive: true });
    writeFileSync(join(userData, "Config", "globalSetting"), options.setting);
  }
  const places: JianyingPlaces = { platform: "darwin", home, applications: [join(base, "nowhere"), applications] };
  return { base, home, app, drafts, places };
}

describe("finding JianYing on a Mac", () => {
  it("finds the app, its version and its draft folder", async () => {
    const { places, app, drafts } = mac();
    expect(await findJianying(places)).toEqual({ state: "ready", install: { version: "11.8.0", app, draftRoot: drafts, timelineFile: "draft_info.json", bundleId: "com.lemon.lvpro" } });
  });

  it("uses the draft folder JianYing's own settings name", async () => {
    const custom = mkdtempSync(join(tmpdir(), "omb-jianying-custom-"));
    dirs.push(custom);
    const { places } = mac({ setting: `[General]\ncacheDate=30\ncurrentCustomDraftPath=${custom}\ncustomPresetPath=/elsewhere\n` });
    expect(await findJianying(places)).toMatchObject({ state: "ready", install: { draftRoot: custom } });
  });

  it("reads a folder name JianYing's settings file escaped", async () => {
    const base = mkdtempSync(join(tmpdir(), "omb-jianying-custom-"));
    dirs.push(base);
    const custom = join(base, "草稿 箱");
    mkdirSync(custom);
    const escaped = `${base}/\\x8349\\x7a3f \\x7bb1`;
    const { places } = mac({ setting: `[General]\r\ncurrentCustomDraftPath="${escaped}"\r\n` });
    expect(await findJianying(places)).toMatchObject({ state: "ready", install: { draftRoot: custom } });
  });

  it("falls back to the usual draft folder when the one in the settings is gone, relative or missing", async () => {
    for (const setting of ["[General]\ncurrentCustomDraftPath=/no/such/folder/anywhere\n", "[General]\ncurrentCustomDraftPath=drafts\n", "[General]\ncacheDate=30\n", ""]) {
      const { places, drafts } = mac({ setting });
      expect(await findJianying(places), setting).toMatchObject({ state: "ready", install: { draftRoot: drafts } });
    }
  });

  it("is not installed without the app, or before JianYing ever made its draft folder", async () => {
    expect(await findJianying(mac({ version: null }).places)).toEqual({ state: "unavailable", reason: "not-installed" });
    expect(await findJianying(mac({ draftFolder: false }).places)).toEqual({ state: "unavailable", reason: "not-installed" });
  });

  it("is an unsupported version when the writer does not know it, or the app does not say", async () => {
    expect(await findJianying(mac({ version: "12.1.0" }).places)).toEqual({ state: "unavailable", reason: "unsupported-version", version: "12.1.0" });
    const silent = mac();
    writeFileSync(join(silent.app, "Contents", "Info.plist"), "bplist00 not xml");
    expect(await findJianying(silent.places)).toEqual({ state: "unavailable", reason: "unsupported-version" });
  });
});

describe("finding JianYing on Windows", () => {
  function windows(versions: string[], draftFolder = true) {
    const base = mkdtempSync(join(tmpdir(), "omb-jianying-win-"));
    dirs.push(base);
    const root = join(base, "JianyingPro");
    const apps = join(root, "Apps");
    const drafts = join(root, "User Data", "Projects", "com.lveditor.draft");
    for (const version of versions) mkdirSync(join(apps, version), { recursive: true });
    if (versions.length) writeFileSync(join(apps, "JianyingPro.exe"), "");
    if (draftFolder) mkdirSync(drafts, { recursive: true });
    return { apps, drafts, places: { platform: "win32", home: join(base, "home"), localAppData: base } satisfies JianyingPlaces };
  }

  it("finds the launcher, the newest installed version and the draft folder, whose timeline file has another name", async () => {
    const { places, apps, drafts } = windows(["11.7.0.9999", "11.8.0.12345", "notes"]);
    expect(await findJianying(places)).toEqual({ state: "ready", install: { version: "11.8.0.12345", app: join(apps, "JianyingPro.exe"), draftRoot: drafts, timelineFile: "draft_content.json" } });
  });

  it("is not installed without the launcher or the draft folder, and unsupported for a version it does not know", async () => {
    expect(await findJianying(windows([]).places)).toEqual({ state: "unavailable", reason: "not-installed" });
    expect(await findJianying(windows(["11.8.0.1"], false).places)).toEqual({ state: "unavailable", reason: "not-installed" });
    expect(await findJianying(windows(["11.8.0.1", "12.0.0.1"]).places)).toEqual({ state: "unavailable", reason: "unsupported-version", version: "12.0.0.1" });
    expect(await findJianying({ platform: "win32", home: "C:\\Users\\me" })).toEqual({ state: "unavailable", reason: "not-installed" });
  });
});

describe("finding JianYing elsewhere", () => {
  it("is not installed on a system JianYing has no desktop app for", async () => {
    expect(await findJianying({ platform: "linux", home: "/home/me" })).toEqual({ state: "unavailable", reason: "not-installed" });
  });

  it("looks, by default, in the person's home and the system's Applications", () => {
    expect(defaultJianyingPlaces("darwin", {}, "/Users/me")).toEqual({ platform: "darwin", home: "/Users/me", applications: ["/Applications", "/Users/me/Applications"] });
    expect(defaultJianyingPlaces("win32", { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "C:\\Users\\me"))
      .toEqual({ platform: "win32", home: "C:\\Users\\me", localAppData: "C:\\Users\\me\\AppData\\Local" });
    expect(defaultJianyingPlaces("win32", {}, "C:\\Users\\me")).toEqual({ platform: "win32", home: "C:\\Users\\me" });
  });
});
