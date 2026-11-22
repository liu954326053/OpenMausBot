import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

import { draftFormatFor } from "./draft-file.ts";

/** Where JianYing is looked for. Every path comes from here, so a test looks in a temporary folder. */
export interface JianyingPlaces {
  platform: NodeJS.Platform;
  /** The person's home folder. */
  home: string;
  /** macOS: the folders an app bundle may be in. */
  applications?: readonly string[];
  /** Windows: `%LOCALAPPDATA%`. */
  localAppData?: string;
}

export interface JianyingInstall {
  version: string;
  /** What starts it: the app bundle on macOS, the launcher on Windows. */
  app: string;
  /** macOS only. */
  bundleId?: string;
  /** The folder JianYing lists drafts from: an existing folder, absolute. */
  draftRoot: string;
  /** The name of a draft's timeline file. */
  timelineFile: "draft_info.json" | "draft_content.json";
}

export type JianyingLookup =
  | { state: "ready"; install: JianyingInstall }
  | { state: "unavailable"; reason: "not-installed" | "unsupported-version"; version?: string };

// JianYing Pro 11.8.0 for macOS: the bundle's name and id, and where it keeps its data.
const MAC_BUNDLE = "VideoFusion-macOS.app";
const MAC_BUNDLE_ID = "com.lemon.lvpro";
const DRAFT_FOLDER = ["Projects", "com.lveditor.draft"];
const SETTINGS_FILE = ["Config", "globalSetting"];
const DRAFT_PATH_KEY = "currentCustomDraftPath";
const SETTINGS_MAX_BYTES = 1024 * 1024;
const NOT_INSTALLED: JianyingLookup = { state: "unavailable", reason: "not-installed" };

export function defaultJianyingPlaces(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): JianyingPlaces {
  if (platform === "darwin") return { platform, home, applications: ["/Applications", join(home, "Applications")] };
  return { platform, home, ...(platform === "win32" && env.LOCALAPPDATA ? { localAppData: env.LOCALAPPDATA } : {}) };
}

const isFolder = async (path: string) => (await stat(path).catch(() => null))?.isDirectory() === true;
const isFile = async (path: string) => (await stat(path).catch(() => null))?.isFile() === true;

/** A value of a Qt settings file: quoted when it holds a separator, with `\\` for a backslash and `\xNNNN` for a
 * character outside Latin-1 (Qt 6, QSettings, "Accessing INI Files"). */
function settingValue(raw: string): string {
  const value = raw.trim();
  const body = value.length >= 2 && value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value;
  return body.replace(/\\(x[0-9a-fA-F]{1,4}|.)/g, (_all, escape: string) => (escape.startsWith("x") && escape.length > 1 ? String.fromCharCode(Number.parseInt(escape.slice(1), 16)) : escape));
}

async function configuredDraftRoot(userData: string): Promise<string | null> {
  const file = join(userData, ...SETTINGS_FILE);
  const size = (await stat(file).catch(() => null))?.size;
  if (size === undefined || size > SETTINGS_MAX_BYTES) return null;
  const text = await readFile(file, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && line.slice(0, at).trim() === DRAFT_PATH_KEY) {
      const path = settingValue(line.slice(at + 1));
      return path && isAbsolute(path) && (await isFolder(path)) ? normalize(path) : null;
    }
  }
  return null;
}

async function draftRootOf(userData: string): Promise<string | null> {
  const configured = await configuredDraftRoot(userData);
  if (configured) return configured;
  const usual = join(userData, ...DRAFT_FOLDER);
  return (await isFolder(usual)) ? usual : null;
}

async function macVersion(app: string): Promise<string | null> {
  const plist = await readFile(join(app, "Contents", "Info.plist"), "utf8").catch(() => "");
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]?.trim() ?? null;
}

const versionParts = (version: string) => version.split(".").map(Number);

function newer(left: string, right: string): number {
  const [a, b] = [versionParts(left), versionParts(right)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** JianYing Pro for Windows keeps each installed version in a folder named for it beside its launcher. */
async function windowsVersion(apps: string): Promise<string | null> {
  const entries = await readdir(apps, { withFileTypes: true }).catch(() => []);
  const versions = entries.filter((entry) => entry.isDirectory() && /^\d+(\.\d+){1,3}$/.test(entry.name)).map((entry) => entry.name);
  return versions.sort(newer).at(-1) ?? null;
}

function found(version: string | null, install: Omit<JianyingInstall, "version">): JianyingLookup {
  if (!version) return { state: "unavailable", reason: "unsupported-version" };
  return draftFormatFor(version) ? { state: "ready", install: { version, ...install } } : { state: "unavailable", reason: "unsupported-version", version };
}

/** Whether JianYing Pro is on this computer, which version, and where it lists drafts from. A JianYing that never ran
 * has no draft folder yet and reads as not installed: its folders are its own to make. */
export async function findJianying(places: JianyingPlaces): Promise<JianyingLookup> {
  if (places.platform === "darwin") {
    let app: string | undefined;
    for (const folder of places.applications ?? []) {
      if (await isFolder(join(folder, MAC_BUNDLE))) {
        app = join(folder, MAC_BUNDLE);
        break;
      }
    }
    const draftRoot = app ? await draftRootOf(join(places.home, "Movies", "JianyingPro", "User Data")) : null;
    if (!app || !draftRoot) return NOT_INSTALLED;
    return found(await macVersion(app), { app, draftRoot, timelineFile: "draft_info.json", bundleId: MAC_BUNDLE_ID });
  }
  if (places.platform === "win32" && places.localAppData) {
    const root = join(places.localAppData, "JianyingPro");
    const app = join(root, "Apps", "JianyingPro.exe");
    const draftRoot = (await isFile(app)) ? await draftRootOf(join(root, "User Data")) : null;
    if (!draftRoot) return NOT_INSTALLED;
    return found(await windowsVersion(join(root, "Apps")), { app, draftRoot, timelineFile: "draft_content.json" });
  }
  return NOT_INSTALLED;
}
