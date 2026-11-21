import type { CanvasGenerateResponse } from "../../shared/project-canvas.ts";
import { serveCanvasFile, uploadToCanvas } from "../project-canvas/files.ts";
import { canvasRefusalOf, type ProjectCanvasService } from "../project-canvas/service.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { userError } from "../user-errors.ts";
import { statusOf } from "./project-generation.ts";
import { PASS, type RouteHandler } from "./table.ts";

const CANVAS = /^\/api\/team-projects\/([\w-]+)\/canvas(?:\/(ops|files|tasks|generate))?$/;
const OPS_BODY_BYTES = 8_000_000;

const record = (body: unknown): Record<string, unknown> => (body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {});

/** A project's canvas, for the owner and admins as the rest of a project is. */
export function createProjectCanvasRoutes(service: ProjectCanvasService): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = CANVAS.exec(path);
    if (!match) return PASS;
    if (!ownerOrAdmin(auth)) {
      req.resume();
      return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    }
    const projectId = match[1]!;
    const part = match[2];
    try {
      if (!part && method === "GET") return json(res, 200, service.snapshot(projectId, auth));
      if (part === "ops" && method === "POST") {
        const project = service.project(projectId);
        return json(res, 200, service.applyRequest(project, { kind: "person" }, await readBody(req, OPS_BODY_BYTES)));
      }
      if (part === "files" && method === "POST") return json(res, 201, await uploadToCanvas(service, projectId, req, url.searchParams));
      if (part === "files" && method === "GET") return await serveCanvasFile(service, projectId, req, res, url.searchParams);
      if (part === "tasks" && method === "POST") return json(res, 202, await service.task(projectId, auth, await readBody(req)));
      if (part === "generate" && method === "POST") {
        const project = service.project(projectId);
        const outcome = await service.generate(project, { kind: "person" }, record(await readBody(req)).nodeId);
        return "refused" in outcome ? json(res, statusOf(outcome.refused), outcome.refused) : json(res, 202, { jobId: outcome.job.id } satisfies CanvasGenerateResponse);
      }
      req.resume();
      return json(res, 405, { error: `${method} is not answered at ${path}` });
    } catch (error) {
      const refused = canvasRefusalOf(error);
      if (!refused) throw error;
      req.resume();
      return json(res, refused.status, refused.body);
    }
  };
}
