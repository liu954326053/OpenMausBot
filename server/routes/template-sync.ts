import { z } from "zod";

import { ownerOrAdmin } from "../request-auth.ts";
import { TemplateLibraryError } from "../template-library.ts";
import {
  applyUpdate, depositMemory, isSyncRefusal, previewUpdate, saveBack,
  type SyncRefusal, type TemplateSyncDeps,
} from "../template-sync-service.ts";
import { userError } from "../user-errors.ts";
import { PASS, type RouteHandler } from "./table.ts";

const saveBackBody = z.object({ mode: z.enum(["version", "new"]) });
const memoryBody = z.object({ botId: z.string().min(1).max(200), path: z.string().min(1).max(400) });

/** The routes behind "模板同步". Each one shows or makes one change the person asked for. They set the persona, the model
 * and the skills of a project's bots, or add to a template, so they are the owner's or an admin's. The library's own
 * refusal (a template gone, a kind full) is thrown by the write side and mapped here the same way the Templates page does. */
export function createTemplateSyncRoutes(deps: TemplateSyncDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/template-sync")) return PASS;
    if (method !== "POST") return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    const answer = <T extends object>(result: T | SyncRefusal, okStatus: number): void =>
      isSyncRefusal(result)
        ? json(res, result.status, userError(result.refusal, result.params))
        : json(res, okStatus, result);
    try {
      let m = path.match(/^\/api\/template-sync\/projects\/([\w-]+)\/update\/preview$/);
      if (m) return answer(previewUpdate(m[1]!, deps), 200);
      m = path.match(/^\/api\/template-sync\/projects\/([\w-]+)\/update$/);
      if (m) return answer(applyUpdate(m[1]!, deps), 200);
      m = path.match(/^\/api\/template-sync\/projects\/([\w-]+)\/save-back$/);
      if (m) {
        const body = saveBackBody.safeParse(await readBody(req, 4096));
        if (!body.success) return json(res, 400, { error: "mode must be 'version' or 'new'" });
        return answer(saveBack(m[1]!, body.data, deps), 200);
      }
      if (path === "/api/template-sync/memory/deposit") {
        const body = memoryBody.safeParse(await readBody(req, 4096));
        if (!body.success) return json(res, 400, { error: "botId and path are required" });
        return answer(depositMemory(body.data, deps), 201);
      }
      return PASS;
    } catch (error) {
      if (error instanceof TemplateLibraryError) return json(res, error.status, error.body);
      throw error;
    }
  };
}
