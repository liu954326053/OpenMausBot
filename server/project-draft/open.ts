import { spawn } from "node:child_process";

import type { JianyingInstall } from "./jianying.ts";

/** Starts a program; true when it started. */
export type ProgramStart = (command: string, args: string[], env: Record<string, string>) => Promise<boolean>;

const START_WAIT_MS = 3000;

// What a program a person starts finds in its environment. Security: nothing else of the server's reaches JianYing:
// no key, no token, and not ELECTRON_RUN_AS_NODE, which the desktop app's server carries.
const MAC_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR"];
const WINDOWS_ENV = [
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "USERPROFILE", "USERNAME", "USERDOMAIN", "HOMEDRIVE", "HOMEPATH",
  "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "TEMP", "TMP", "PUBLIC", "ALLUSERSPROFILE",
];

function cleanEnvironment(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Record<string, string> {
  const allowed = new Set(platform === "win32" ? WINDOWS_ENV : MAC_ENV);
  const kept = Object.entries(env).filter(([name, value]) => value !== undefined && allowed.has(platform === "win32" ? name.toUpperCase() : name));
  return Object.fromEntries(kept) as Record<string, string>;
}

/** No shell and a fixed command line. True when the program ended well, or is still running after `waitMs`: a
 * program that is the app itself does not end. Not windowsHide, which starts a Windows GUI program hidden. */
export const startDetached = (command: string, args: string[], env: Record<string, string>, waitMs: number = START_WAIT_MS): Promise<boolean> =>
  new Promise((done) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: false, env });
    } catch {
      return done(false);
    }
    const timer = setTimeout(() => done(true), waitMs);
    child.once("error", () => {
      clearTimeout(timer);
      done(false);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
    child.unref();
  });

/**
 * Brings JianYing to the front, starting it when it is not running: the app, not a draft. JianYing 11.8.0 has no
 * entry that opens a draft by its folder or name: its `videocut://` and `vega://` links reach panels of an editor
 * that is already open, its account sign-in and cloud drafts, and its `--draft_path` argument starts its
 * text-template tool.
 */
export async function launchJianying(
  install: JianyingInstall,
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; start?: ProgramStart } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const start = options.start ?? startDetached;
  const env = cleanEnvironment(options.env ?? process.env, platform);
  if (platform === "darwin") return start("/usr/bin/open", ["-a", install.app], env);
  if (platform === "win32") return start(install.app, [], env);
  return false;
}
