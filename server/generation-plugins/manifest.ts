import {
  PLUGIN_FIELDS_MAX, PLUGIN_ID, PLUGIN_MODELS_MAX, GENERATION_PLUGIN_SCHEMA_VERSION,
  normalizePluginUrl, type GenerationPluginField, type GenerationPluginFieldType,
} from "../../shared/generation-plugins.ts";
import { IMAGE_COUNT_MAX, type GenerationKind, type GenerationModel } from "../../shared/project-generation.ts";

/** One HTTP call a plugin declares: what to send, and where in the answer each part is. */
export interface PluginRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  answer: {
    taskId?: string;
    files?: PluginFiles;
    status?: string;
    progress?: string;
    error?: string;
    pollAfterMs?: string;
    pollAfterSeconds?: string;
  };
}

/** Either a path to a list of addresses or base64 data, or a list of objects with those inside them. */
export type PluginFiles = { path: string } | { items: string; url?: string; data?: string; name?: string; mimeType?: string };

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  models: GenerationModel[];
  fields: GenerationPluginField[];
  requests: { generate: PluginRequest; status?: PluginRequest; cancel?: PluginRequest };
  statusMap: Record<"queued" | "running" | "succeeded" | "failed" | "cancelled", string[]>;
}

export class ManifestProblem extends Error {
  override name = "ManifestProblem";
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const FIELD_TYPES: ReadonlySet<string> = new Set(["text", "url", "secret", "number", "boolean", "select"]);
const KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const LIST_MAX = 50;
const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" && value.length <= 200 ? value : undefined);
const problem = (message: string): never => { throw new ManifestProblem(message); };

function strings(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) problem(`${label} must be a list`);
  const out = value.slice(0, LIST_MAX).filter((item): item is string => typeof item === "string" && item.trim() !== "" && item.length <= 200);
  return out.length ? out : undefined;
}

function numbers(value: unknown, label: string): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) problem(`${label} must be a list`);
  const out = value.slice(0, LIST_MAX).filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item > 0);
  return out.length ? out : undefined;
}

function models(value: unknown): GenerationModel[] {
  if (!Array.isArray(value) || value.length === 0) problem("models must list at least one model");
  if (value.length > PLUGIN_MODELS_MAX) problem(`models may list at most ${PLUGIN_MODELS_MAX} models`);
  const out: GenerationModel[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) problem("each model must be an object");
    const id = text(raw.id);
    const kind = raw.kind === "image" || raw.kind === "video" ? raw.kind : undefined;
    if (!id) problem("each model needs an id of up to 200 characters");
    if (!kind) problem(`model ${id} needs a kind of image or video`);
    if (seen.has(`${kind}\u0000${id}`)) problem(`model ${id} is listed twice`);
    seen.add(`${kind}\u0000${id}`);
    const count = typeof raw.maxCount === "number" && Number.isInteger(raw.maxCount) && raw.maxCount >= 1
      ? Math.min(raw.maxCount, IMAGE_COUNT_MAX) : undefined;
    out.push({
      id, name: text(raw.name) ?? id, kind,
      ...(kind === "video" ? {
        resolutions: strings(raw.resolutions, `model ${id} resolutions`),
        durations: numbers(raw.durations, `model ${id} durations`),
      } : {
        qualities: strings(raw.qualities, `model ${id} qualities`),
        ...(count ? { maxCount: count } : {}),
      }),
      aspects: strings(raw.aspects, `model ${id} aspects`),
      referenceImages: raw.referenceImages === true,
      referenceAudio: kind === "video" && raw.referenceAudio === true,
    } as GenerationModel);
  }
  return out;
}

function fields(value: unknown): GenerationPluginField[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) problem("config must be a list of fields");
  if (value.length > PLUGIN_FIELDS_MAX) problem(`config may have at most ${PLUGIN_FIELDS_MAX} fields`);
  const out: GenerationPluginField[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) problem("each config field must be an object");
    const key = raw.key;
    if (typeof key !== "string" || !KEY.test(key)) problem("each config field needs a key of letters, digits, _ . -");
    if (seen.has(key)) problem(`config field ${key} is listed twice`);
    seen.add(key!);
    const type = raw.type;
    if (typeof type !== "string" || !FIELD_TYPES.has(type)) problem(`config field ${key} needs a type: text, url, secret, number, boolean or select`);
    const label = text(raw.label) ?? key!;
    const choices = strings(raw.choices, `config field ${key} choices`);
    if (type === "select" && !choices) problem(`config field ${key} is a select, so it needs choices`);
    const fallback = raw.default;
    const defaultValue = typeof fallback === "string" ? fallback.slice(0, 2000)
      : typeof fallback === "number" && Number.isFinite(fallback) ? fallback
      : typeof fallback === "boolean" ? fallback : undefined;
    if (defaultValue !== undefined && type === "url" && typeof defaultValue === "string" && defaultValue !== "") {
      try { normalizePluginUrl(defaultValue); } catch (error) { problem(`config field ${key}: ${(error as Error).message}`); }
    }
    out.push({
      key: key!, label, type: type as GenerationPluginFieldType,
      ...(raw.required === true ? { required: true } : {}),
      ...(typeof raw.placeholder === "string" ? { placeholder: raw.placeholder.slice(0, 200) } : {}),
      ...(typeof raw.help === "string" ? { help: raw.help.slice(0, 300) } : {}),
      ...(choices ? { choices } : {}),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    });
  }
  return out;
}

function placeholders(value: unknown, found: Set<string>): void {
  if (typeof value === "string") { for (const match of value.matchAll(PLACEHOLDER)) found.add(match[1]!); return; }
  if (Array.isArray(value)) { for (const item of value) placeholders(item, found); return; }
  if (isRecord(value)) { for (const item of Object.values(value)) placeholders(item, found); }
}

function request(value: unknown, label: string, fieldKeys: ReadonlySet<string>): PluginRequest {
  if (!isRecord(value)) problem(`${label} must be an object`);
  const method = typeof value.method === "string" ? value.method.toUpperCase() : "POST";
  if (!METHODS.has(method)) problem(`${label}.method must be GET, POST, PUT, PATCH or DELETE`);
  const url = value.url;
  if (typeof url !== "string" || url.trim() === "" || url.length > 4096) problem(`${label}.url must be an address`);
  const headers: Record<string, string> = {};
  if (value.headers !== undefined) {
    if (!isRecord(value.headers)) problem(`${label}.headers must be an object of strings`);
    for (const [name, header] of Object.entries(value.headers)) {
      if (typeof header !== "string" || header.length > 4096 || /[\r\n]/.test(header) || /[\r\n]/.test(name)) problem(`${label}.headers.${name} must be one line of text`);
      headers[name] = header;
    }
  }
  if (value.answer !== undefined && !isRecord(value.answer)) problem(`${label}.answer must say where each part of the answer is`);
  const said = isRecord(value.answer) ? value.answer : {};
  const answer: PluginRequest["answer"] = {};
  for (const key of ["taskId", "status", "progress", "error", "pollAfterMs", "pollAfterSeconds"] as const) {
    const path = said[key];
    if (path === undefined) continue;
    if (typeof path !== "string" || !/^[A-Za-z0-9_$[\]*.-]{1,300}$/.test(path)) problem(`${label}.answer.${key} must be a path in the answer, such as data[].url`);
    answer[key] = path;
  }
  const files = said.files;
  if (files !== undefined) {
    if (typeof files === "string" && /^[A-Za-z0-9_$[\]*.-]{1,300}$/.test(files)) answer.files = { path: files };
    else if (isRecord(files) && typeof files.items === "string" && /^[A-Za-z0-9_$[\]*.-]{1,300}$/.test(files.items)) {
      const nested = (key: "url" | "data" | "name" | "mimeType") => (typeof files[key] === "string" && /^[A-Za-z0-9_$[\]*.-]{0,300}$/.test(files[key] as string) ? (files[key] as string) : undefined);
      const mapped = { items: files.items, ...Object.fromEntries(Object.entries({ url: nested("url"), data: nested("data"), name: nested("name"), mimeType: nested("mimeType") }).filter(([, item]) => item)) };
      if (!mapped.url && !mapped.data) problem(`${label}.answer.files needs url or data inside each item`);
      answer.files = mapped as PluginFiles;
    } else problem(`${label}.answer.files must be a path, or an object with items and url or data`);
  }
  if (label.endsWith("generate") && !answer.taskId && !answer.files) problem(`${label}.answer needs taskId or files`);
  if (label.endsWith("status") && !answer.status) problem(`${label}.answer needs status`);
  const used = new Set<string>();
  placeholders(url, used); placeholders(headers, used); placeholders(value.body, used);
  for (const name of used) {
    if (name.startsWith("config.")) {
      if (!fieldKeys.has(name.slice("config.".length))) problem(`${label} uses ${name}, which is not a config field`);
    } else if (!["model", "prompt", "aspect", "quality", "count", "resolution", "seconds", "taskId", "referenceImages", "referenceAudio"].includes(name)) {
      problem(`${label} uses {{${name}}}, which MagicBot does not fill in`);
    }
  }
  return { method: method as PluginRequest["method"], url, headers, ...(value.body === undefined ? {} : { body: value.body }), answer };
}

function statusMap(value: unknown): PluginManifest["statusMap"] {
  const out: PluginManifest["statusMap"] = { queued: [], running: [], succeeded: [], failed: [], cancelled: [] };
  if (value === undefined) return out;
  if (!isRecord(value)) problem("statusMap must be an object");
  for (const status of STATUSES) {
    const words = strings(value[status], `statusMap.${status}`);
    if (words) out[status] = words.map((word) => word.toLowerCase());
  }
  return out;
}

/** The plugin file, checked; a `ManifestProblem` says in words what is wrong with it. `expectedId` is the folder's name. */
export function readManifest(raw: unknown, expectedId?: string): PluginManifest {
  if (!isRecord(raw)) problem("plugin.json must be an object");
  if (raw.schemaVersion !== GENERATION_PLUGIN_SCHEMA_VERSION) problem(`plugin.json must have "schemaVersion": ${GENERATION_PLUGIN_SCHEMA_VERSION}`);
  const id = raw.id;
  if (typeof id !== "string" || !PLUGIN_ID.test(id)) problem("plugin.json needs an id of 2-64 lowercase letters, digits or dashes");
  if (expectedId !== undefined && id !== expectedId) problem(`plugin.json says its id is ${id}, but it is installed as ${expectedId}`);
  const name = raw.name;
  if (typeof name !== "string" || name.trim() === "" || name.length > 80) problem("plugin.json needs a name of up to 80 characters");
  const version = raw.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) problem("plugin.json needs a version such as 1.0.0");
  if (!isRecord(raw.requests)) problem("plugin.json needs requests.generate");
  const parsedFields = fields(raw.config);
  const keys = new Set(parsedFields.map((field) => field.key));
  const generate = request(raw.requests.generate, "requests.generate", keys);
  const status = raw.requests.status === undefined ? undefined : request(raw.requests.status, "requests.status", keys);
  const cancel = raw.requests.cancel === undefined ? undefined : request(raw.requests.cancel, "requests.cancel", keys);
  if (generate.answer.taskId && !status) problem("requests.generate answers a task, so requests.status is needed to follow it");
  return {
    schemaVersion: 1, id: id!, name: name!.trim(), version: version!,
    ...(typeof raw.description === "string" && raw.description.trim() ? { description: raw.description.trim().slice(0, 300) } : {}),
    ...(typeof raw.author === "string" && raw.author.trim() ? { author: raw.author.trim().slice(0, 120) } : {}),
    models: models(raw.models),
    fields: parsedFields,
    requests: { generate, ...(status ? { status } : {}), ...(cancel ? { cancel } : {}) },
    statusMap: statusMap(raw.statusMap),
  };
}

export function pluginKinds(manifest: PluginManifest): GenerationKind[] {
  const kinds = new Set(manifest.models.map((model) => model.kind));
  return (["image", "video"] as const).filter((kind) => kinds.has(kind));
}
