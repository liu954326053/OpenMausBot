import { useSyncExternalStore } from "react";
import { z } from "zod";

/** The sidebar as it is, or "icons": the column of avatars the person dragged its edge down to. */
export type SidebarDensity = "comfortable" | "icons";
export type SidebarToolsLayout = "rows" | "toolbar";

export const SIDEBAR_TOOLS_LAYOUTS: readonly SidebarToolsLayout[] = ["rows", "toolbar"];

export const SIDEBAR_DENSITY_KEY = "openmausbot.sidebarDensity";
export const SIDEBAR_TOOLS_LAYOUT_KEY = "openmausbot.sidebarToolsLayout";
export const SIDEBAR_WIDTH_KEY = "openmausbot.sidebarWidth";
export const SIMPLE_SIDEBAR_WIDTH_KEY = "openmausbot.sidebarWidth.simple";
export const SIDEBAR_COLLAPSED_SECTIONS_KEY = "openmausbot.sidebarCollapsedSections.v1";

/** What the sidebar's key keeps for the column of avatars. The values an older app kept there ("compact", "icons") open
 * the sidebar as it is. */
const AVATARS = "avatars";

export function parseSidebarDensity(value: string | null): SidebarDensity {
  return value === AVATARS ? "icons" : "comfortable";
}

export function loadSidebarDensity(storage?: Pick<Storage, "getItem"> | null): SidebarDensity {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarDensity(target?.getItem(SIDEBAR_DENSITY_KEY) ?? null);
  } catch {
    return "comfortable";
  }
}

export function saveSidebarDensity(
  density: SidebarDensity,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_DENSITY_KEY, density === "icons" ? AVATARS : density);
  } catch {
  }
}

export function parseSidebarToolsLayout(value: string | null): SidebarToolsLayout {
  switch (value) {
    case "rows":
    case "toolbar":
      return value;
    default:
      return "rows";
  }
}

export function loadSidebarToolsLayout(storage?: Pick<Storage, "getItem"> | null): SidebarToolsLayout {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarToolsLayout(target?.getItem(SIDEBAR_TOOLS_LAYOUT_KEY) ?? null);
  } catch {
    return "rows";
  }
}

export function saveSidebarToolsLayout(
  layout: SidebarToolsLayout,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_TOOLS_LAYOUT_KEY, layout);
  } catch {
  }
}

let densitySessionChoice: SidebarDensity | undefined;
const densityListeners = new Set<() => void>();

function currentSidebarDensity(): SidebarDensity {
  return densitySessionChoice ?? loadSidebarDensity();
}

function notifyDensity() {
  for (const listener of densityListeners) listener();
}

function onDensityStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_DENSITY_KEY && event.key !== null) return;
  try {
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
  } catch {
    return;
  }
  densitySessionChoice = undefined;
  notifyDensity();
}

function subscribeDensity(listener: () => void): () => void {
  densityListeners.add(listener);
  if (densityListeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onDensityStorage);
  }
  return () => {
    densityListeners.delete(listener);
    if (densityListeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onDensityStorage);
    }
  };
}

export function setSidebarDensity(density: SidebarDensity): void {
  densitySessionChoice = density;
  saveSidebarDensity(density);
  notifyDensity();
}

export function useSidebarDensity(): SidebarDensity {
  return useSyncExternalStore(subscribeDensity, currentSidebarDensity, () => "comfortable");
}

let toolsLayoutSessionChoice: SidebarToolsLayout | undefined;
const toolsLayoutListeners = new Set<() => void>();

function currentSidebarToolsLayout(): SidebarToolsLayout {
  return toolsLayoutSessionChoice ?? loadSidebarToolsLayout();
}

function notifyToolsLayout() {
  for (const listener of toolsLayoutListeners) listener();
}

function onToolsLayoutStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_TOOLS_LAYOUT_KEY && event.key !== null) return;
  try {
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
  } catch {
    return;
  }
  toolsLayoutSessionChoice = undefined;
  notifyToolsLayout();
}

export function subscribeSidebarToolsLayout(listener: () => void): () => void {
  toolsLayoutListeners.add(listener);
  if (toolsLayoutListeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onToolsLayoutStorage);
  }
  return () => {
    toolsLayoutListeners.delete(listener);
    if (toolsLayoutListeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onToolsLayoutStorage);
    }
  };
}

export function setSidebarToolsLayout(layout: SidebarToolsLayout): void {
  toolsLayoutSessionChoice = layout;
  saveSidebarToolsLayout(layout);
  notifyToolsLayout();
}

export function useSidebarToolsLayout(): SidebarToolsLayout {
  return useSyncExternalStore(subscribeSidebarToolsLayout, currentSidebarToolsLayout, () => "rows");
}

/** The narrowest the open sidebar gets. */
export const SIDEBAR_MIN_WIDTH = 240;

export function clampSidebarWidth(width: number, viewportWidth: number, max = 480): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(max, viewportWidth - 320, Math.round(width)));
}

export function loadSidebarWidth(storage?: Pick<Storage, "getItem"> | null, key = SIDEBAR_WIDTH_KEY): number | null {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    const raw = target?.getItem(key);
    if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
    const width = Number(raw);
    return width >= SIDEBAR_MIN_WIDTH && width <= 480 ? width : null;
  } catch {
    return null;
  }
}

export function saveSidebarWidth(width: number, storage?: Pick<Storage, "setItem"> | null, key = SIDEBAR_WIDTH_KEY): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(key, String(width));
  } catch {
  }
}

const stringListSchema = z.array(z.string().min(1).max(240));

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = stringListSchema.safeParse(parsed);
    return result.success ? [...new Set(result.data)].slice(0, 100) : [];
  } catch {
    return [];
  }
}

function loadStringList(
  key: string,
  storage?: Pick<Storage, "getItem"> | null,
): string[] {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseStringList(target?.getItem(key) ?? null);
  } catch {
    return [];
  }
}

function saveStringList(
  key: string,
  values: string[],
  storage?: Pick<Storage, "setItem"> | null,
): string[] {
  const safe = [
    ...new Set(values.filter((value) => value.length > 0 && value.length <= 240)),
  ].slice(0, 100);
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(key, JSON.stringify(safe));
  } catch {
  }
  return safe;
}

export function loadCollapsedSections(storage?: Pick<Storage, "getItem"> | null): string[] {
  return loadStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, storage);
}

export function saveCollapsedSections(
  ids: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  saveStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, ids, storage);
}

export function toggleCollapsedSection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

/** Bots whose sidebar thread list stays at "Show all N threads" until the person picks "Show fewer". */
export const SIDEBAR_SHOW_ALL_KEY = "openmausbot.sidebarShowAllThreads.v1";

let showAllBots: ReadonlySet<string> | null = null;
const showAllListeners = new Set<() => void>();

function currentShowAllBots(): ReadonlySet<string> {
  // With no list mounted, no storage listener kept the cache current: another window may have changed it.
  if (showAllListeners.size === 0) showAllBots = null;
  showAllBots ??= new Set(loadStringList(SIDEBAR_SHOW_ALL_KEY));
  return showAllBots;
}

function notifyShowAll(): void {
  for (const listener of showAllListeners) listener();
}

function onShowAllStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== SIDEBAR_SHOW_ALL_KEY) return;
  if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
  showAllBots = null;
  notifyShowAll();
}

function subscribeShowAll(listener: () => void): () => void {
  if (showAllListeners.size === 0) globalThis.addEventListener?.("storage", onShowAllStorage);
  showAllListeners.add(listener);
  return () => {
    showAllListeners.delete(listener);
    if (showAllListeners.size === 0) globalThis.removeEventListener?.("storage", onShowAllStorage);
  };
}

export function setSidebarShowAllThreads(botId: string, showAll: boolean): void {
  const saved = currentShowAllBots();
  if (saved.has(botId) === showAll) return;
  // Newest first, so the stored list's cap drops the oldest bots.
  const next = showAll ? [botId, ...saved] : [...saved].filter((id) => id !== botId);
  showAllBots = new Set(saveStringList(SIDEBAR_SHOW_ALL_KEY, next));
  notifyShowAll();
}

/** A bot's "Show all N threads", remembered so it survives collapsing the bot and reloading the app. */
export function useSidebarShowAllThreads(botId: string): [boolean, (showAll: boolean) => void] {
  const read = () => currentShowAllBots().has(botId);
  return [useSyncExternalStore(subscribeShowAll, read, () => false), (showAll) => setSidebarShowAllThreads(botId, showAll)];
}

export function forgetSidebarShowAllForTests(): void {
  showAllBots = null;
}
