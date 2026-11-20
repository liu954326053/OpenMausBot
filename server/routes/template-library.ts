import { z } from "zod";

import { PACKAGE_MAX_BYTES } from "../../shared/package-format.ts";
import type { TemplateKind, TemplateLibraryEditor } from "../../shared/template-library.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { TemplateLibraryError } from "../template-library.ts";
import { userError } from "../user-errors.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** A whole template as JSON: the package's bytes, with room for its pictures as base64 and the JSON around them. */
const BODY_MAX = PACKAGE_MAX_BYTES + 2 * 1024 * 1024;
const KIND = { bots: "bot", teams: "team" } as const satisfies Record<string, TemplateKind>;
const undoBody = z.object({ undo: z.string().min(1).max(200) });
const fromBotBody = z.object({ botId: z.string().min(1).max(200) });
const fromDepartmentBody = z.object({ department: z.string().min(1).max(200) });

/** The Templates page's routes. A whole template and every change are the owner's or an admin's: a template sets the
 * persona and the model of every project made from it. The list names templates only, so it answers whoever the
 * request gate lets this far. */
export function createTemplateLibraryRoutes(library: TemplateLibraryEditor): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/template-library")) return PASS;
    if (path === "/api/template-library" && method === "GET") return json(res, 200, library.list());
    if (!ownerOrAdmin(auth)) return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    try {
      if (path === "/api/template-library/restore" && method === "POST") {
        const body = undoBody.safeParse(await readBody(req, 4096));
        if (!body.success) return json(res, 409, userError("serverError.templateLibrary.undoGone"));
        return json(res, 200, { ok: true, ...library.restore(body.data.undo) });
      }
      if (path === "/api/template-library/bots/from-bot" && method === "POST") {
        const body = fromBotBody.safeParse(await readBody(req, 4096));
        if (!body.success) return json(res, 404, userError("serverError.bot.missing"));
        return json(res, 201, { template: library.saveFromBot(body.data.botId) });
      }
      if (path === "/api/template-library/teams/from-department" && method === "POST") {
        const body = fromDepartmentBody.safeParse(await readBody(req, 4096));
        if (!body.success) return json(res, 404, userError("serverError.templateLibrary.noBots"));
        return json(res, 201, { template: library.saveFromDepartment(body.data.department) });
      }
      const all = path.match(/^\/api\/template-library\/(bots|teams)$/);
      if (all && method === "POST") {
        const body = await readBody(req, BODY_MAX);
        return json(res, 201, { template: all[1] === "bots" ? library.saveBot(body) : library.saveTeam(body) });
      }
      const one = path.match(/^\/api\/template-library\/(bots|teams)\/([a-f0-9]{16})$/);
      if (!one) return PASS;
      const kind = KIND[one[1] as keyof typeof KIND], id = one[2]!;
      if (method === "GET") {
        const template = kind === "bot" ? library.botTemplate(id) : library.teamTemplate(id);
        return template ? json(res, 200, { template }) : json(res, 404, userError("serverError.templateLibrary.notFound"));
      }
      if (method === "PUT") {
        const body = await readBody(req, BODY_MAX);
        return json(res, 200, { template: kind === "bot" ? library.saveBot(body, id) : library.saveTeam(body, id) });
      }
      if (method === "DELETE") return json(res, 200, { ok: true, ...library.remove(kind, id) });
      return PASS;
    } catch (error) {
      if (error instanceof TemplateLibraryError) return json(res, error.status, error.body);
      throw error;
    }
  };
}
