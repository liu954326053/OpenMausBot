import type {
  GenerationFailure, GenerationJobWire, GenerationJobsWire, GenerationModelsWire, GenerationSettingsWire, ProjectGenerationApi, ProjectGenerationSettings,
} from "../../shared/project-generation.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { userError } from "../user-errors.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ProjectGenerationRouteHost extends ProjectGenerationApi {
  servers(): string[];
}

const ROUTE = /^\/api\/team-projects\/([\w-]+)\/generation\/(settings|models|jobs)(?:\/([\w-]+)(\/cancel)?)?$/;

const STATUS: Record<GenerationFailure["code"], number> = {
  invalid: 400, project_unavailable: 409, no_server: 422, server_unusable: 422, sign_in: 409, keys: 409, unreachable: 502, tool_missing: 422,
  no_model: 422, model_unknown: 422, setting_refused: 422, reference_refused: 422, too_many: 429, confirmation_needed: 409,
  bad_answer: 502, task_failed: 502, download_failed: 502, timed_out: 504, interrupted: 409,
};

export const statusOf = (refusal: GenerationFailure) =>
  (refusal.errorKey === "serverError.teamProject.notFound" ? 404 : STATUS[refusal.code]);

/** A project's generation settings, its MCP server's models and its jobs; the owner's or an admin's, as the project is. */
export function createProjectGenerationRoutes(host: ProjectGenerationRouteHost): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = path.match(ROUTE);
    if (!match) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    const [, projectId = "", area, jobId, cancel] = match;
    const refuse = (refusal: GenerationFailure) => json(res, statusOf(refusal), refusal);
    const settingsWire = (settings: ProjectGenerationSettings): GenerationSettingsWire => ({ settings, servers: host.servers() });

    if (area === "settings" && !jobId) {
      if (method === "GET") {
        const settings = host.settings(projectId);
        return settings ? json(res, 200, settingsWire(settings)) : json(res, 404, userError("serverError.teamProject.notFound"));
      }
      if (method === "PUT") {
        const saved = await host.saveSettings(projectId, await readBody(req));
        return "refused" in saved ? refuse(saved.refused) : json(res, 200, settingsWire(saved.settings));
      }
    }
    if (area === "models" && !jobId && method === "GET") {
      const kind = url.searchParams.get("kind");
      if (kind !== "image" && kind !== "video") return json(res, 400, userError("serverError.projectGeneration.invalid", { detail: "kind must be image or video" }));
      const server = url.searchParams.get("server");
      const tool = url.searchParams.get("tool");
      const listed = await host.models(projectId, kind, server ? { server, ...(tool ? { tool } : {}) } : undefined);
      return "refused" in listed ? refuse(listed.refused) : json(res, 200, { models: listed.models } satisfies GenerationModelsWire);
    }
    if (area === "jobs" && !jobId) {
      if (method === "GET") return json(res, 200, { jobs: host.jobs(projectId) } satisfies GenerationJobsWire);
      if (method === "POST") {
        const started = await host.start(projectId, await readBody(req), { requester: { kind: "person" } });
        return "refused" in started ? refuse(started.refused) : json(res, 202, { job: started.job } satisfies GenerationJobWire);
      }
    }
    if (area === "jobs" && jobId) {
      const job = cancel ? method === "POST" && host.cancel(projectId, jobId) : method === "GET" && host.job(projectId, jobId);
      if (job) return json(res, 200, { job } satisfies GenerationJobWire);
      if (job === null) return json(res, 404, userError("serverError.projectGeneration.jobGone"));
    }
    return PASS;
  };
}
