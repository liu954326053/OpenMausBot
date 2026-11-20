import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { UserErrorKey } from "../user-errors.ts";

export type TeamProjectsRootCheck = { ok: true; root: string } | { ok: false; error: UserErrorKey };

export function isInsideFolder(path: string, folder: string): boolean {
  const inside = relative(folder, path);
  return inside === "" || !(inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside));
}

function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Security: a project's folder is one its bots work in and write to. It must never be the app's own data folder or
 * a folder inside it, neither as the path is written nor where a link in it leads.
 */
export function isInAppData(path: string, dataDir: string): boolean {
  return isInsideFolder(resolve(path), resolve(dataDir)) || isInsideFolder(realPath(path), realPath(dataDir));
}

/** Whether `path` can be the folder new projects are made in. */
export function checkTeamProjectsRoot(path: unknown, dataDir: string): TeamProjectsRootCheck {
  const given = typeof path === "string" ? path.trim() : "";
  if (!given || !isAbsolute(given)) return { ok: false, error: "serverError.teamProject.rootNotAbsolute" };
  const root = resolve(given);
  try {
    if (!statSync(root).isDirectory()) return { ok: false, error: "serverError.teamProject.rootNotFolder" };
  } catch {
    return { ok: false, error: "serverError.teamProject.rootNotFolder" };
  }
  if (isInAppData(root, dataDir)) return { ok: false, error: "serverError.teamProject.rootInData" };
  try {
    accessSync(root, constants.W_OK | constants.X_OK);
  } catch {
    return { ok: false, error: "serverError.teamProject.rootReadOnly" };
  }
  return { ok: true, root };
}
