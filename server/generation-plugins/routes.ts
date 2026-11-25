import type { GenerationPluginWire, GenerationPluginsWire, SaveGenerationPluginInput } from "../../shared/generation-plugins.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { userError } from "../user-errors.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { PluginRefused, type GenerationPlugins } from "./store.ts";

const ROUTE = /^\/api\/generation-plugins(?:\/(install|[\w-]+))?$/;
const ZIP_MAX = 2 * 8 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The installed generation plugins: their list, a zip to install, and one plugin's state and settings. */
export function createGenerationPluginRoutes(plugins: GenerationPlugins): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = path.match(ROUTE);
    if (!match) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, userError("serverError.chat.ownerOrAdmin"));
    const [, id] = match;
    const refused = (error: unknown) => json(res, 400, { error: error instanceof Error ? error.message : String(error) });

    if (id === undefined && method === "GET") {
      return json(res, 200, { plugins: plugins.list() } satisfies GenerationPluginsWire);
    }
    if (id === "install" && method === "POST") {
      const body = await readBody(req, ZIP_MAX) as unknown;
      if (!isRecord(body) || typeof body.name !== "string" || typeof body.data !== "string") {
        return json(res, 400, { error: "Send the plugin's name and its zip data" });
      }
      const name = body.name.trim().slice(0, 200) || "plugin.zip";
      if (body.data.length > ZIP_MAX * 1.4) return json(res, 400, { error: `${name} is larger than 8 MB` });
      let bytes: Buffer;
      try { bytes = Buffer.from(body.data.replace(/\s/g, ""), "base64"); }
      catch { return json(res, 400, { error: `${name} could not be read` }); }
      try {
        return json(res, 200, { plugin: plugins.install(name, bytes) } satisfies GenerationPluginWire);
      } catch (error) {
        if (error instanceof PluginRefused) return refused(error);
        throw error;
      }
    }
    if (id !== undefined && id !== "install" && method === "PATCH") {
      const body = await readBody(req, 64 * 1024) as unknown;
      if (!isRecord(body)) return json(res, 400, { error: "Send the plugin's settings as an object" });
      const patch = body as SaveGenerationPluginInput;
      try {
        return json(res, 200, { plugin: plugins.save(id, patch) } satisfies GenerationPluginWire);
      } catch (error) {
        if (error instanceof PluginRefused) return refused(error);
        throw error;
      }
    }
    if (id !== undefined && id !== "install" && method === "DELETE") {
      try {
        plugins.remove(id);
        return json(res, 200, { ok: true });
      } catch (error) {
        if (error instanceof PluginRefused) return json(res, 404, { error: error.message });
        throw error;
      }
    }
    return PASS;
  };
}
