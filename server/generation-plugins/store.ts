import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  PLUGIN_FIELDS_MAX, PLUGIN_FILES_MAX, PLUGIN_UNPACKED_MAX_BYTES, PLUGIN_ZIP_MAX_BYTES,
  normalizePluginUrl, type GenerationPluginField, type GenerationPluginSummary, type GenerationPluginValue, type SaveGenerationPluginInput,
} from "../../shared/generation-plugins.ts";
import { writeFileAtomic } from "../atomic.ts";
import { ManifestProblem, pluginKinds, readManifest, type PluginManifest } from "./manifest.ts";
import { readZip, ZipProblem, type ZipEntry } from "./zip.ts";

export class PluginRefused extends Error {
  override name = "PluginRefused";
}

interface StoredManifest {
  /** The file's mtime, in nanoseconds: a rewrite in the same millisecond still reads as a change. */
  at: string;
  manifest: PluginManifest | null;
  problem?: string;
}

const refused = (message: string): never => { throw new PluginRefused(message); };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export interface GenerationPluginsOptions {
  dataDir: string;
  log?(line: string): void;
  now?(): number;
}

/** The plugin folders under the data directory: installing, removing, their config, and what they declare. */
export class GenerationPlugins {
  readonly root: string;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly parsed = new Map<string, StoredManifest>();
  private stateCache: Record<string, unknown> | null = null;
  private configCache: Record<string, unknown> | null = null;
  private secretsCache: Record<string, unknown> | null = null;

  constructor(options: GenerationPluginsOptions) {
    this.root = join(options.dataDir, "plugins");
    this.log = options.log ?? ((line: string) => console.info(line));
    this.now = options.now ?? Date.now;
    mkdirSync(this.root, { recursive: true });
  }

  /** Every installed plugin, readable or not, by name. */
  list(): GenerationPluginSummary[] {
    const state = this.state();
    const config = this.config();
    const secrets = this.secrets();
    const out: GenerationPluginSummary[] = [];
    for (const id of this.folders()) {
      const entry = this.parsed.get(id);
      if (!entry?.manifest) {
        out.push({
          id, name: id, version: "", kinds: [], models: [], fields: [], enabled: false, configured: false, values: {}, secrets: [],
          ...(entry?.problem ? { problem: entry.problem } : {}),
        });
        continue;
      }
      const manifest = entry.manifest;
      const saved = isRecord(config[id]) ? config[id] : {};
      const kept = isRecord(secrets[id]) ? secrets[id] : {};
      const values: Record<string, GenerationPluginValue> = {};
      for (const field of manifest.fields) {
        if (field.type === "secret") continue;
        const value = saved[field.key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[field.key] = value;
        else if (field.default !== undefined) values[field.key] = field.default;
      }
      const present = manifest.fields.filter((field) => field.type === "secret" && typeof kept[field.key] === "string" && kept[field.key] !== "");
      const record = isRecord(state[id]) ? state[id] : {};
      out.push({
        id, name: manifest.name, version: manifest.version,
        ...(manifest.description ? { description: manifest.description } : {}),
        ...(manifest.author ? { author: manifest.author } : {}),
        kinds: pluginKinds(manifest), models: manifest.models, fields: manifest.fields,
        enabled: record.enabled === true,
        configured: manifest.fields.every((field) => {
          if (!field.required) return true;
          if (field.type === "secret") return present.some((one) => one.key === field.key);
          const value = values[field.key];
          return value !== undefined && value !== "";
        }),
        values, secrets: present.map((field) => field.key),
        ...(typeof record.installedAt === "number" ? { installedAt: record.installedAt } : {}),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The plugin's manifest; null when there is no such plugin or its file cannot be read. */
  manifest(id: string): PluginManifest | null {
    this.remember(id);
    return this.parsed.get(id)?.manifest ?? null;
  }

  /** Every field's value, secrets included. Never send this anywhere but into a request. */
  resolve(id: string): { values: Record<string, GenerationPluginValue>; secrets: Record<string, string> } | null {
    const manifest = this.manifest(id);
    if (!manifest) return null;
    const saved = isRecord(this.config()[id]) ? this.config()[id] as Record<string, unknown> : {};
    const kept = isRecord(this.secrets()[id]) ? this.secrets()[id] as Record<string, unknown> : {};
    const values: Record<string, GenerationPluginValue> = {};
    const secrets: Record<string, string> = {};
    for (const field of manifest.fields) {
      if (field.type === "secret") {
        if (typeof kept[field.key] === "string" && kept[field.key] !== "") secrets[field.key] = kept[field.key] as string;
        continue;
      }
      const value = saved[field.key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[field.key] = value;
      else if (field.default !== undefined) values[field.key] = field.default;
    }
    return { values, secrets };
  }

  install(name: string, bytes: Buffer): GenerationPluginSummary {
    if (bytes.length > PLUGIN_ZIP_MAX_BYTES) refused("That plugin is larger than 8 MB");
    let entries: ZipEntry[];
    try {
      entries = readZip(bytes, { maxFiles: PLUGIN_FILES_MAX, maxFileBytes: PLUGIN_UNPACKED_MAX_BYTES, maxTotalBytes: PLUGIN_UNPACKED_MAX_BYTES });
    } catch (error) {
      if (error instanceof ZipProblem) refused(`${name}: ${error.message}`);
      throw error;
    }
    const root = pluginRoot(entries);
    const file = root.find((entry) => entry.path.toLowerCase() === "plugin.json");
    if (!file) refused(`${name} has no plugin.json at its top`);
    let manifest: PluginManifest;
    try {
      manifest = readManifest(JSON.parse(file.data.toString("utf8")));
    } catch (error) {
      if (error instanceof ManifestProblem) refused(`${name}: ${error.message}`);
      if (error instanceof SyntaxError) refused(`${name}: plugin.json is not valid JSON`);
      throw error;
    }
    const staging = join(this.root, `.install-${randomUUID()}`);
    mkdirSync(staging, { recursive: true, mode: 0o755 });
    try {
      for (const entry of root) {
        const target = join(staging, ...entry.path.split("/"));
        mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
        writeFileSync(target, entry.data, { mode: 0o644 });
      }
      const destination = join(this.root, manifest.id);
      const previous = join(this.root, `.replaced-${randomUUID()}`);
      if (existsSync(destination)) renameSync(destination, previous);
      renameSync(staging, destination);
      if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    this.parsed.delete(manifest.id);
    const state = { ...this.state(), [manifest.id]: { enabled: true, installedAt: this.now() } };
    this.write("state.json", state);
    this.stateCache = state;
    this.log(`generation plugins: installed ${manifest.id} ${manifest.version}`);
    const summary = this.list().find((plugin) => plugin.id === manifest.id);
    if (!summary) refused("That plugin could not be read after installing it");
    return summary!;
  }

  remove(id: string): void {
    this.requireFolder(id);
    rmSync(join(this.root, id), { recursive: true, force: true });
    for (const name of ["state.json", "config.json", "secrets.json"] as const) {
      const all = { ...this.read(name) };
      delete all[id];
      this.write(name, all);
    }
    this.stateCache = null; this.configCache = null; this.secretsCache = null;
    this.parsed.delete(id);
    this.log(`generation plugins: removed ${id}`);
  }

  save(id: string, patch: SaveGenerationPluginInput): GenerationPluginSummary {
    this.requireFolder(id);
    const manifest = this.manifest(id);
    if (!manifest) refused(`The plugin ${id} cannot be read`);
    if (patch.enabled !== undefined) this.stateSave(id, patch.enabled);
    if (patch.values !== undefined) {
      if (Object.keys(patch.values).length > PLUGIN_FIELDS_MAX) refused("That is more settings than a plugin has");
      const fields = new Map(manifest.fields.map((field) => [field.key, field]));
      const config = { ...this.config() };
      const secrets = { ...this.secrets() };
      const plain = isRecord(config[id]) ? { ...config[id] } : {};
      const kept = isRecord(secrets[id]) ? { ...secrets[id] } : {};
      for (const [key, value] of Object.entries(patch.values)) {
        const field = fields.get(key);
        if (!field) refused(`This plugin has no setting called ${key}`);
        const checked = checkValue(field, value);
        if (field.type === "secret") {
          if (checked === "") continue;
          kept[key] = checked;
        } else if (checked === "") delete plain[key];
        else plain[key] = checked;
      }
      config[id] = plain;
      secrets[id] = kept;
      this.write("config.json", config);
      this.write("secrets.json", secrets, 0o600);
      this.configCache = config;
      this.secretsCache = secrets;
    }
    const summary = this.list().find((plugin) => plugin.id === id);
    if (!summary) refused(`The plugin ${id} is gone`);
    return summary!;
  }

  /** Where the plugin's own address starts, for fetching its results; null when it declares none. */
  origin(id: string): string | null {
    const resolved = this.resolve(id);
    if (!resolved) return null;
    const declared = this.manifest(id)?.fields.find((field) => field.type === "url" && typeof resolved.values[field.key] === "string");
    const value = declared ? String(resolved.values[declared.key]) : "";
    try { return value ? new URL(value).origin : null; } catch { return null; }
  }

  private requireFolder(id: string): void {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id) || !this.folders().includes(id)) refused(`There is no plugin called ${id}`);
  }

  /** Folder names under the plugins folder, each read at most once per file change. */
  private folders(): string[] {
    if (!existsSync(this.root)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      out.push(entry.name);
      this.remember(entry.name);
    }
    for (const known of this.parsed.keys()) if (!out.includes(known)) this.parsed.delete(known);
    return out.sort((a, b) => a.localeCompare(b));
  }

  private remember(id: string): void {
    const file = join(this.root, id, "plugin.json");
    let at = "";
    try {
      const info = lstatSync(file, { bigint: true });
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("plugin.json is not a plain file");
      at = info.mtimeNs.toString();
    } catch {
      this.parsed.set(id, { at: "-", manifest: null, problem: "plugin.json is missing" });
      return;
    }
    const kept = this.parsed.get(id);
    if (kept && kept.at === at) return;
    try {
      this.parsed.set(id, { at, manifest: readManifest(JSON.parse(readFileSync(file, "utf8")), id) });
    } catch (error) {
      const problem = error instanceof ManifestProblem ? error.message : error instanceof SyntaxError ? "plugin.json is not valid JSON" : "plugin.json cannot be read";
      this.parsed.set(id, { at, manifest: null, problem });
    }
  }

  private read(name: string): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(readFileSync(join(this.root, name), "utf8"));
      return isRecord(value) ? value : {};
    } catch { return {}; }
  }

  private write(name: string, value: unknown, mode?: number): void {
    const file = join(this.root, name);
    writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
    if (mode !== undefined) {
      try { chmodSync(file, mode); } catch { /* Windows has no mode bits; the folder is still the user's own. */ }
    }
  }

  private state(): Record<string, unknown> { this.stateCache ??= this.read("state.json"); return this.stateCache; }
  private config(): Record<string, unknown> { this.configCache ??= this.read("config.json"); return this.configCache; }
  private secrets(): Record<string, unknown> { this.secretsCache ??= this.read("secrets.json"); return this.secretsCache; }

  private stateSave(id: string, enabled: boolean): void {
    const state = { ...this.state(), [id]: { ...(isRecord(this.state()[id]) ? this.state()[id] : {}), enabled } };
    this.write("state.json", state);
    this.stateCache = state;
  }
}

/** The files of a plugin, with a single wrapping folder (as most zip tools make) taken off. */
function pluginRoot(entries: ZipEntry[]): ZipEntry[] {
  const hasRootFile = entries.some((entry) => entry.path.toLowerCase() === "plugin.json");
  if (hasRootFile) return entries;
  const tops = new Set(entries.map((entry) => entry.path.split("/")[0]));
  if (tops.size !== 1) return entries;
  const top = [...tops][0]!;
  const inside = entries.filter((entry) => entry.path.startsWith(`${top}/`)).map((entry) => ({ ...entry, path: entry.path.slice(top.length + 1) }));
  if (!inside.some((entry) => entry.path.toLowerCase() === "plugin.json")) refused("The plugin archive has no plugin.json at its top");
  return inside;
}

function checkValue(field: GenerationPluginField, value: unknown): string | number | boolean {
  if (field.type === "boolean") {
    if (typeof value === "boolean") return value;
    refused(`The setting ${field.label} is on or off`);
  }
  if (field.type === "number") {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(number)) refused(`The setting ${field.label} must be a number`);
    return number;
  }
  if (typeof value !== "string") refused(`The setting ${field.label} must be text`);
  const text = value.trim();
  if (text.length > 4000) refused(`The setting ${field.label} is too long`);
  if (field.type === "url" && text !== "") {
    try { return normalizePluginUrl(text); } catch (error) { refused(`The setting ${field.label}: ${(error as Error).message}`); }
  }
  if (field.type === "select" && text !== "" && !(field.choices ?? []).includes(text)) refused(`The setting ${field.label} must be one of ${(field.choices ?? []).join(", ")}`);
  return text;
}

export { KEY as PLUGIN_FIELD_KEY };
