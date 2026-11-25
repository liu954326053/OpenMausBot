// A disposable preview of the generation plugin manager and the project settings that choose a plugin. It talks to an
// in-memory /api, so no installed plugin, key, project or MagicBot app is touched.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer } from "vite";

import type { GenerationPluginSummary } from "../shared/generation-plugins.ts";

const PORT = Number(process.env.OMB_PLUGIN_PREVIEW_PORT ?? 8840);

const image = { id: "pixel-1", name: "Pixel 1", kind: "image" as const, aspects: ["1:1", "16:9", "9:16"], qualities: ["standard", "hd"], maxCount: 4, referenceImages: true, referenceAudio: false };
const video = { id: "motion-1", name: "Motion 1", kind: "video" as const, resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], durations: [5, 10], referenceImages: true, referenceAudio: true };

const fields = [
  { key: "baseUrl", label: "API address", type: "url" as const, required: true, default: "https://api.acme.test/v1" },
  { key: "apiKey", label: "API key", type: "secret" as const, required: true },
];

const plugins: GenerationPluginSummary[] = [
  {
    id: "acme-images", name: "Acme Images", version: "1.0.0", description: "Sample image and video API", kinds: ["image", "video"],
    models: [image, video], fields, enabled: true, configured: true, values: { baseUrl: "https://api.acme.test/v1" }, secrets: ["apiKey"], installedAt: Date.now(),
  },
  {
    id: "studio-motion", name: "Studio Motion", version: "0.4.2", description: "Sample video API", kinds: ["video"],
    models: [video], fields, enabled: false, configured: false, values: { baseUrl: "https://studio.example.test/v2" }, secrets: [], installedAt: Date.now(),
  },
];

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

const json = (res: ServerResponse, value: unknown, status = 200) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
};

const http = createHttpServer();
const ui = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../.omb-scratch/generation-plugins-preview-vite", import.meta.url)),
  server: { middlewareMode: { server: http }, hmr: { server: http } },
  plugins: [{ name: "generation-plugins-preview", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      if (path === "/api/generation-plugins" && req.method === "GET") return json(res, { plugins });
      if (path === "/api/generation-plugins/install" && req.method === "POST") {
        void body(req).then((value) => {
          const name = String((value as { name?: unknown } | null)?.name ?? "plugin.zip");
          plugins.unshift({
            id: "uploaded-api", name: "Uploaded API", version: "1.0.0", description: `Installed from ${name}`, kinds: ["image"],
            models: [image], fields, enabled: true, configured: false, values: { baseUrl: "https://uploaded.example.test/v1" }, secrets: [], installedAt: Date.now(),
          });
          return json(res, { plugin: plugins[0] });
        });
        return;
      }
      const one = /^\/api\/generation-plugins\/([\w-]+)$/.exec(path);
      if (one && req.method === "PATCH") {
        void body(req).then((value) => {
          const patch = (value ?? {}) as { enabled?: boolean; values?: Record<string, string> };
          const found = plugins.find((plugin) => plugin.id === one[1]);
          if (!found) return json(res, { error: "There is no such plugin" }, 404);
          if (patch.enabled !== undefined) found.enabled = patch.enabled;
          if (patch.values) {
            for (const [key, item] of Object.entries(patch.values)) {
              if (found.fields.find((field) => field.key === key)?.type === "secret") { if (item) found.secrets = [...new Set([...found.secrets, key])]; }
              else found.values[key] = item;
            }
            found.configured = found.secrets.length > 0;
          }
          return json(res, { plugin: found });
        });
        return;
      }
      if (one && req.method === "DELETE") {
        const at = plugins.findIndex((plugin) => plugin.id === one[1]);
        if (at < 0) return json(res, { error: "There is no such plugin" }, 404);
        plugins.splice(at, 1);
        return json(res, { ok: true });
      }
      if (path === "/api/team-projects/demo/generation/models") {
        const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
        const kind = query.get("kind");
        return json(res, { models: (kind === "video" ? [video] : [image]) });
      }
      if (path !== "/__plugins.html") return next();
      void server.transformIndexHtml(req.url!, '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenMaus · Generation plugins preview</title></head><body class="bg-app"><div id="root"></div><script type="module" src="/scripts/testing/generation-plugins-preview.tsx"></script></body></html>')
        .then((html) => { res.setHeader("content-type", "text/html"); res.end(html); })
        .catch(next);
    });
  } }],
});
http.on("request", ui.middlewares);
await new Promise<void>((resolve) => http.listen(PORT, "127.0.0.1", () => resolve()));
mkdirSync("/tmp/omb-plugins", { recursive: true });
console.log(JSON.stringify({ previewUrl: `http://127.0.0.1:${PORT}/__plugins.html`, port: PORT }));
