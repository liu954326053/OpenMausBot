import type { GenerationKind, GenerationModel } from "../../shared/project-generation.ts";
import { fillTemplate, readNumber, readPath, readStrings, readText } from "./template.ts";
import { maskedServerText, refused } from "../project-generation/failure.ts";
import { normalizeStatus, type GenerationEndpoint, type GenerationRequest, type Submitted, type TaskState } from "../project-generation/endpoint.ts";
import type { ResultSource } from "../project-generation/project-files.ts";
import type { PluginFiles, PluginManifest, PluginRequest } from "./manifest.ts";
import type { GenerationPlugins } from "./store.ts";

export const PLUGIN_ANSWER_MAX_BYTES = 64 * 1024 * 1024;
const TEXT_LIMIT = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Security: a plugin's own words may echo its key or address, so they are masked and clipped before a person reads them. */
function readable(value: string, configured: readonly string[]): string {
  return maskedServerText(value, configured).slice(0, TEXT_LIMIT);
}

function addressOf(raw: string, label: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch {
    throw refused("unreachable", "unreachable", { server: label, detail: "its address is not a web address" });
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal", "host.containers.internal"].includes(url.hostname.toLowerCase())
    || url.hostname.toLowerCase().endsWith(".local");
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) {
    throw refused("unreachable", "unreachable", { server: label, detail: "its address is not https, or http on this computer" });
  }
  return url;
}

async function boundedText(response: Response, label: string): Promise<string> {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > PLUGIN_ANSWER_MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw refused("bad_answer", "badAnswer", { server: label, tool: "request", detail: "its answer is larger than 64 MB" });
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > PLUGIN_ANSWER_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw refused("bad_answer", "badAnswer", { server: label, tool: "request", detail: "its answer is larger than 64 MB" });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function filesOf(data: unknown, mapping: PluginFiles): ResultSource[] {
  const out: ResultSource[] = [];
  if ("path" in mapping) {
    for (const item of readStrings(data, mapping.path)) {
      out.push(/^https?:\/\//i.test(item) ? { url: item } : { data: item });
    }
    return out;
  }
  const found = readPath(data, mapping.items);
  for (const item of Array.isArray(found) ? found : found === undefined ? [] : [found]) {
    const name = readText(item, mapping.name);
    const url = readText(item, mapping.url);
    const inline = readText(item, mapping.data);
    const picked = url ? { url } : inline ? { data: inline } : null;
    if (picked) out.push({ ...picked, ...(name ? { name } : {}) });
  }
  return out;
}

/** One installed plugin, spoken to directly over the requests its `plugin.json` declares. */
export function pluginEndpoint(plugins: GenerationPlugins, id: string, fetchImpl: typeof fetch = fetch): GenerationEndpoint {
  const manifest = (): PluginManifest => {
    const found = plugins.manifest(id);
    if (!found) throw refused("server_unusable", "pluginGone", { plugin: id });
    return found;
  };
  const summary = () => plugins.list().find((plugin) => plugin.id === id);
  const label = () => summary()?.name ?? id;

  const usable = (): PluginManifest => {
    const current = summary();
    if (!current) throw refused("server_unusable", "pluginGone", { plugin: id });
    if (!current.enabled) throw refused("server_unusable", "pluginOff", { plugin: current.name });
    if (current.problem) throw refused("server_unusable", "pluginGone", { plugin: current.name });
    if (!current.configured) throw refused("server_unusable", "pluginUnconfigured", { plugin: current.name });
    return manifest();
  };

  const call = async (declared: PluginRequest, vars: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Record<string, unknown>> => {
    usable();
    const resolved = plugins.resolve(id)!;
    const configured = [
      ...Object.values(resolved.secrets), ...Object.values(resolved.values).filter((value) => typeof value === "string"),
      ...Object.values(declared.headers),
    ].map(String);
    const name = label();
    const url = addressOf(String(fillTemplate(declared.url, vars)), name);
    const headers = Object.fromEntries(Object.entries(declared.headers).map(([key, value]) => [key, String(fillTemplate(value, vars))]));
    const body = declared.body === undefined ? undefined : fillTemplate(declared.body, vars);
    if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: declared.method,
        headers,
        ...(body === undefined || declared.method === "GET" ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal,
      });
    } catch {
      if (signal.aborted) throw refused("unreachable", "unreachable", { server: name, detail: "MagicBot stopped waiting for it" });
      throw refused("unreachable", "unreachableNetwork", { server: name });
    }
    let text: string;
    try { text = await boundedText(response, name); }
    catch (error) { if (signal.aborted) throw refused("unreachable", "unreachable", { server: name, detail: "MagicBot stopped waiting for it" }); throw error; }
    const parsed = (() => {
      try { const value: unknown = JSON.parse(text); return isRecord(value) ? value : null; } catch { return null; }
    })();
    if (!response.ok) {
      const said = parsed ? readText(parsed, declared.answer.error) : undefined;
      if (said) throw refused("task_failed", "taskFailed", { server: name, reason: readable(said, configured) }, { reason: readable(said, configured) });
      throw refused("unreachable", "unreachable", { server: name, detail: `it answered HTTP ${response.status}` });
    }
    if (!parsed) throw refused("bad_answer", "pluginBadAnswer", { plugin: name, detail: "its answer is not a JSON object" });
    return parsed;
  };

  return {
    label: label(),
    async listModels(): Promise<GenerationModel[]> {
      usable();
      return manifest().models;
    },
    async generate(kind: GenerationKind, settings: unknown, request: GenerationRequest, signal: AbortSignal): Promise<Submitted> {
      const current = usable();
      const own = isRecord(settings) ? settings : {};
      const variables = buildVariables(id, plugins, kind, own, request);
      const answer = await call(current.requests.generate, variables, signal);
      const taskId = readText(answer, current.requests.generate.answer.taskId);
      if (taskId) return { taskId };
      const files = filesOf(answer, current.requests.generate.answer.files ?? { path: "" });
      if (files.length) return { files };
      throw refused("bad_answer", "badAnswer", { server: label(), tool: "generate", detail: "it gave neither files nor a task id" });
    },
    async status(taskId: string, signal: AbortSignal): Promise<TaskState> {
      const current = usable();
      const declared = current.requests.status;
      if (!declared) return refused("bad_answer", "badAnswer", { server: label(), tool: "status", detail: "it has no request for a task's status" });
      const answer = await call(declared, buildVariables(id, plugins, "image", {}, { prompt: "", references: { images: [], audio: [] } }, taskId), signal);
      const status = normalizeStatus(readText(answer, declared.answer.status), current.statusMap);
      if (!status) throw refused("bad_answer", "badAnswer", { server: label(), tool: "status", detail: "it gave no status MagicBot knows" });
      if (status === "succeeded") {
        const files = filesOf(answer, declared.answer.files ?? { path: "" });
        if (!files.length) throw refused("bad_answer", "badAnswer", { server: label(), tool: "status", detail: "it said the task succeeded but gave no files" });
        return { status, files };
      }
      if (status === "failed") {
        const resolved = plugins.resolve(id);
        const configured = [...Object.values(resolved?.secrets ?? {}), ...Object.values(declared.headers)].map(String);
        const said = readText(answer, declared.answer.error);
        return { status, reason: said ? readable(said, configured) || "the plugin gave no reason" : "the plugin gave no reason" };
      }
      if (status === "cancelled") return { status };
      const progress = readNumber(answer, declared.answer.progress);
      const pollAfterMs = readNumber(answer, declared.answer.pollAfterMs)
        ?? (readNumber(answer, declared.answer.pollAfterSeconds) !== undefined ? readNumber(answer, declared.answer.pollAfterSeconds)! * 1000 : undefined);
      return {
        status,
        ...(progress === undefined ? {} : { progress: Math.min(1, Math.max(0, progress > 1 ? progress / 100 : progress)) }),
        ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
      };
    },
    async cancel(taskId: string, signal: AbortSignal): Promise<boolean> {
      const current = usable();
      if (!current.requests.cancel) return false;
      await call(current.requests.cancel, buildVariables(id, plugins, "image", {}, { prompt: "", references: { images: [], audio: [] } }, taskId), signal);
      return true;
    },
    resultOrigin: () => plugins.origin(id),
  };
}

function buildVariables(id: string, plugins: GenerationPlugins, kind: GenerationKind, settings: Record<string, unknown>, request: GenerationRequest, taskId?: string): Record<string, unknown> {
  const resolved = plugins.resolve(id);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved?.values ?? {})) out[`config.${key}`] = value;
  for (const [key, value] of Object.entries(resolved?.secrets ?? {})) out[`config.${key}`] = value;
  out.model = settings.model ?? "";
  out.prompt = request.prompt;
  out.aspect = settings.aspect ?? "";
  if (kind === "image") {
    out.quality = settings.quality ?? "";
    out.count = settings.count ?? 1;
  } else {
    out.resolution = settings.resolution ?? "";
    out.seconds = settings.seconds ?? 0;
  }
  out.referenceImages = request.references.images;
  out.referenceAudio = request.references.audio;
  if (taskId !== undefined) out.taskId = taskId;
  return out;
}
