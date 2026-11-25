import { join } from "node:path";

import {
  DEFAULT_GENERATION_SETTINGS, resolveSettings, settingProblems, type GenerationFailure, type GenerationKind, type GenerationModel,
  type GenerationReferences, type ImageOverrides, type ProjectGenerationApi, type ProjectGenerationSettings,
  type StartGenerationInput, type VideoOverrides,
} from "../../shared/project-generation.ts";
import type { TeamProjectLookup } from "../../shared/team-projects.ts";
import type { GenerationPlugins } from "../generation-plugins/store.ts";
import { pluginEndpoint } from "../generation-plugins/endpoint.ts";
import { isRemoteMcpServer, parseStoredMcpServer } from "../mcp-registry.ts";
import type { RouteHandler } from "../routes/table.ts";
import { createProjectGenerationRoutes } from "../routes/project-generation.ts";
import { teamProjectFolderReady } from "../team-project-folders.ts";
import { userError } from "../user-errors.ts";
import { BotCeiling } from "./ceiling.ts";
import { conventionEndpoint } from "./convention.ts";
import type { GenerationEndpoint } from "./endpoint.ts";
import { failure, GenerationRefused, refused } from "./failure.ts";
import { GenerationJobs, UNFINISHED_PER_PROJECT, type JobTiming } from "./jobs.ts";
import { createGenerationMcp, type GenerationMcp, type GenerationMcpDeps, type McpCaller } from "./mcp-access.ts";
import { readReferences } from "./project-files.ts";
import { mergeSettings, problemFailure, storedSettings } from "./settings.ts";
import { GenerationStore, isProjectId } from "./store.ts";

const LIST_CALL_MS = 30_000;
const PROMPT_MAX = 20_000;
const NODE_ID_MAX = 200;
const NAME_MAX = 200;
const KINDS = ["image", "video"] as const;

export interface ProjectGenerationDeps extends Omit<GenerationMcpDeps, "connections"> {
  dataDir: string;
  lookup: TeamProjectLookup;
  log?(line: string): void;
  now?(): number;
  mcp?: GenerationMcp;
  /** The installed plugins; without them, a project's settings can only name MCP servers. */
  plugins?: GenerationPlugins;
  timing?: Partial<JobTiming>;
}

export interface ProjectGeneration {
  api: ProjectGenerationApi;
  /** The MCP servers a project may choose. */
  servers(): string[];
  /** The installed plugins a project may choose, whatever their state. */
  plugins(): ReturnType<GenerationPlugins["list"]>;
  routes: RouteHandler;
  close(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const invalid = (detail: string) => refused("invalid", "invalid", { detail });
const failureOf = (error: unknown, server: string): GenerationFailure =>
  (error instanceof GenerationRefused ? error.failure : failure("unreachable", "unreachable", { server, detail: "MagicBot could not ask it" }));
const noServer = (kind: GenerationKind) => refused("no_server", kind === "image" ? "noImageServer" : "noVideoServer");

function paths(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((path) => typeof path === "string" && path.length <= 1024)) throw invalid(`${label} must be a list of paths in the project folder`);
  return value as string[];
}

function startInput(raw: unknown): StartGenerationInput & { references: GenerationReferences } {
  if (!isRecord(raw)) throw invalid("send the generation as an object");
  const { kind, nodeId, prompt, references, overrides, name } = raw;
  if (kind !== "image" && kind !== "video") throw invalid("kind must be image or video");
  if (typeof nodeId !== "string" || !nodeId || nodeId.length > NODE_ID_MAX) throw invalid("nodeId must name the canvas node");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > PROMPT_MAX) throw invalid(`the prompt must say what to make, in up to ${PROMPT_MAX} characters`);
  if (references !== undefined && !isRecord(references)) throw invalid("references must be an object");
  if (overrides !== undefined && overrides !== null && !isRecord(overrides)) throw invalid("overrides must be an object");
  if (name !== undefined && (typeof name !== "string" || name.length > NAME_MAX)) throw invalid(`name must be up to ${NAME_MAX} characters`);
  return {
    kind, nodeId, prompt,
    references: { images: paths(references?.images, "references.images"), audio: paths(references?.audio, "references.audio") },
    ...(overrides ? { overrides: overrides as ImageOverrides | VideoOverrides } : {}),
    ...(name ? { name } : {}),
  };
}

/** Project generation as the server runs it: the settings, the models, the jobs, and their routes. */
export function createProjectGeneration(deps: ProjectGenerationDeps): ProjectGeneration {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? Date.now;
  const store = new GenerationStore(join(deps.dataDir, "project-generation"), log);
  const mcp = deps.mcp ?? createGenerationMcp(deps);
  const ceiling = new BotCeiling(store, now);

  const summaryOf = (plugin: string) => deps.plugins?.list().find((candidate) => candidate.id === plugin);
  const callerOf = (requester: { kind: "person" } | { kind: "bot"; botId: string }) => (requester.kind === "bot" ? { botId: requester.botId } : {});

  const known = (projectId: string) => isProjectId(projectId) && deps.lookup(projectId) !== undefined;
  const notFound = (): GenerationFailure => ({ code: "project_unavailable", ...userError("serverError.teamProject.notFound") });
  const folderOf = (projectId: string): string => {
    const project = isProjectId(projectId) ? deps.lookup(projectId) : undefined;
    if (!project) throw new GenerationRefused(notFound());
    if (!teamProjectFolderReady(project.folder)) throw refused("project_unavailable", "projectFolderMissing");
    return project.folder;
  };
  const serverUrl = (server: string): string | null => {
    const raw = deps.storedServers()[server];
    const parsed = raw === undefined ? null : parseStoredMcpServer(server, raw);
    return parsed?.ok && isRemoteMcpServer(parsed.server) ? parsed.server.url : null;
  };

  const jobs = new GenerationJobs({ store, mcp, folderOf, endpointOf: (job, tools) => {
    if (!job.plugin) return conventionEndpoint(mcp, job.server, tools, callerOf(job.requester), serverUrl(job.server));
    if (!deps.plugins) throw refused("server_unusable", "pluginGone", { plugin: job.plugin });
    return pluginEndpoint(deps.plugins, job.plugin);
  }, log, now, timing: deps.timing });

  function settingsOf(projectId: string): ProjectGenerationSettings {
    const own = storedSettings(store.settings(projectId));
    if (own) return own;
    const start = storedSettings(store.lastSettings()) ?? structuredClone(DEFAULT_GENERATION_SETTINGS);
    store.saveSettings(projectId, start);
    return start;
  }

  function endpointOf(kind: GenerationKind, own: ProjectGenerationSettings[GenerationKind], as: McpCaller): GenerationEndpoint {
    if (own.plugin) {
      if (!deps.plugins) throw refused("server_unusable", "pluginGone", { plugin: own.plugin });
      return pluginEndpoint(deps.plugins, own.plugin);
    }
    if (!own.server) throw noServer(kind);
    return conventionEndpoint(mcp, own.server, own.tools, as, serverUrl(own.server));
  }

  /** A model list is asked for every time: a plugin's file and a server's settings may have changed since the last look. */
  function modelsOf(kind: GenerationKind, own: ProjectGenerationSettings[GenerationKind], as: McpCaller): Promise<GenerationModel[]> {
    return endpointOf(kind, own, as).listModels(AbortSignal.timeout(LIST_CALL_MS));
  }

  function usable(own: ProjectGenerationSettings[GenerationKind]): void {
    if (own.plugin) {
      if (!deps.plugins) throw refused("server_unusable", "pluginGone", { plugin: own.plugin });
      return;
    }
    if (!own.server) return;
    const unusable = mcp.unusable(own.server);
    if (unusable) throw refused("server_unusable", unusable.name, unusable.params);
  }

  const api: ProjectGenerationApi = {
    settings: (projectId) => (known(projectId) ? settingsOf(projectId) : null),

    async saveSettings(projectId, patch) {
      if (!known(projectId)) return { refused: notFound() };
      const current = settingsOf(projectId);
      const merged = mergeSettings(current, patch);
      if (typeof merged === "string") return { refused: failure("invalid", "settingsInvalid", { detail: merged }) };
      for (const kind of KINDS) {
        const next = merged[kind];
        if ((!next.server && !next.plugin) || JSON.stringify(next) === JSON.stringify(current[kind])) continue;
        try {
          usable(next);
          if (!next.defaults.model) continue;
          const listed = await modelsOf(kind, next, {});
          const problems = settingProblems(kind, next.defaults, listed);
          if (problems.length) return { refused: problemFailure(next.plugin ? (summaryOf(next.plugin)?.name ?? next.plugin) : next.server!, next.defaults.model, listed, problems) };
        } catch (error) {
          return { refused: failureOf(error, next.plugin ?? next.server ?? "") };
        }
      }
      store.saveSettings(projectId, merged);
      store.saveLastSettings(merged);
      return { settings: merged };
    },

    async models(projectId, kind, preview) {
      if (!known(projectId)) return { refused: notFound() };
      const own = settingsOf(projectId)[kind];
      const chosen = preview?.plugin ?? (preview?.server ? null : own.plugin ?? null);
      if (chosen !== null) {
        if (!deps.plugins) return { refused: failure("server_unusable", "pluginGone", { plugin: chosen }) };
        try {
          const endpoint = pluginEndpoint(deps.plugins, chosen);
          return { models: (await endpoint.listModels(AbortSignal.timeout(LIST_CALL_MS))).filter((model) => model.kind === kind) };
        } catch (error) {
          return { refused: failureOf(error, chosen) };
        }
      }
      const server = preview?.server ?? own.server;
      if (!server) return { refused: noServer(kind).failure };
      try {
        usable({ ...own, plugin: null, server });
        const listed = await modelsOf(kind, { ...own, plugin: null, server, tools: preview?.tool ? { ...own.tools, listModels: preview.tool } : own.tools }, {});
        return { models: listed.filter((model) => model.kind === kind) };
      } catch (error) {
        return { refused: failureOf(error, server) };
      }
    },

    async start(projectId, raw, options) {
      let named = "";
      try {
        const folder = folderOf(projectId);
        if (deps.lookup(projectId)?.archivedAt !== undefined) throw refused("project_unavailable", "projectArchived");
        const input = startInput(raw);
        const { kind } = input;
        const own = settingsOf(projectId)[kind];
        const plugin = own.plugin ?? null;
        if (!own.server && !plugin) throw noServer(kind);
        const endpoint = endpointOf(kind, own, options.requester.kind === "bot" ? { botId: options.requester.botId } : {});
        named = endpoint.label;
        const settings = resolveSettings(kind, own.defaults, input.overrides);
        if (!settings.model) throw refused("no_model", kind === "image" ? "noImageModel" : "noVideoModel");
        usable(own);
        const unfinished = jobs.unfinished(projectId);
        if (unfinished >= UNFINISHED_PER_PROJECT) throw refused("too_many", "tooMany", { count: unfinished });
        readReferences(folder, input.references);
        const as: McpCaller = options.requester.kind === "bot" ? { botId: options.requester.botId } : {};
        const listed = await modelsOf(kind, own, as);
        const problems = settingProblems(kind, settings, listed, { images: input.references.images.length, audio: input.references.audio.length });
        if (problems.length) throw new GenerationRefused(problemFailure(named, settings.model, listed, problems));
        if (!plugin && !(await mcp.toolNames(own.server!, as, AbortSignal.timeout(LIST_CALL_MS))).has(own.tools.generate)) {
          throw refused("tool_missing", "toolMissing", { server: own.server!, tool: own.tools.generate });
        }
        const results = kind === "image" ? (settings as { count: number }).count : 1;
        const over = ceiling.check(options.requester, kind, results);
        if (over) throw new GenerationRefused(over);
        ceiling.record(options.requester, kind, results);
        const job = jobs.create({
          projectId, kind, nodeId: input.nodeId, requester: options.requester, prompt: input.prompt, references: input.references,
          settings, server: plugin ?? own.server!, tools: own.tools, ...(plugin ? { plugin } : {}), ...(input.name ? { name: input.name } : {}),
        }, options.onChange);
        return { job };
      } catch (error) {
        return { refused: failureOf(error, named) };
      }
    },

    job: (projectId, jobId) => (isProjectId(projectId) ? jobs.job(projectId, jobId) : null),
    jobs: (projectId) => (isProjectId(projectId) ? jobs.jobs(projectId) : []),
    cancel: (projectId, jobId) => (isProjectId(projectId) ? jobs.cancel(projectId, jobId) : null),
    onJobChange: (listener) => jobs.onChange(listener),
    botAllowance: (_projectId, botId) => ceiling.allowance(botId),
  };

  jobs.resume();
  const servers = () => mcp.choosable();
  const plugins = () => deps.plugins?.list() ?? [];
  return {
    api,
    servers,
    plugins,
    routes: createProjectGenerationRoutes({ ...api, servers, plugins }),
    close: () => {
      jobs.close();
      mcp.close();
    },
  };
}
