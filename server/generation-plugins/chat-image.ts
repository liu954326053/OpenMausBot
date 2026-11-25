import type { ImageAspect, GeneratedImage } from "../image-generation.ts";
import { resultBytes } from "../project-generation/project-files.ts";
import { pluginEndpoint } from "./endpoint.ts";
import type { GenerationPlugins } from "./store.ts";

const POLL_MS = 2_000;
const MIN_POLL_MS = 500;
const MAX_POLL_MS = 30_000;
const DEADLINE_MS = 5 * 60_000;

export interface PluginImageRequest {
  prompt: string;
  aspect?: ImageAspect;
  signal?: AbortSignal;
}

/** The chat's picture channel through an installed plugin: the first image model of the first ready plugin. */
export interface PluginImages {
  ready(): boolean;
  /** The name and model a reply credits, such as `Acme Images (pixel-1)`. */
  by(): string;
  generate(request: PluginImageRequest): Promise<GeneratedImage>;
}

const pick = (plugins: GenerationPlugins) => plugins.list().find((plugin) =>
  plugin.enabled && plugin.configured && !plugin.problem && plugin.models.some((model) => model.kind === "image"));

const wait = (ms: number, signal: AbortSignal | undefined) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  signal?.addEventListener("abort", stop, { once: true });
});

export function createPluginImages(plugins: GenerationPlugins): PluginImages {
  return {
    ready: () => pick(plugins) !== undefined,
    by: () => {
      const plugin = pick(plugins);
      if (!plugin) return "";
      return `${plugin.name} (${plugin.models.find((model) => model.kind === "image")?.id ?? ""})`;
    },
    async generate(request: PluginImageRequest): Promise<GeneratedImage> {
      const plugin = pick(plugins);
      if (!plugin) throw Object.assign(new Error("Connect an image plugin in Apps → Plugins first"), { status: 409, neverStarted: true });
      const model = plugin.models.find((candidate) => candidate.kind === "image")!;
      const endpoint = pluginEndpoint(plugins, plugin.id);
      const deadline = Date.now() + DEADLINE_MS;
      const signal = request.signal;
      const submitted = await endpoint.generate(
        "image",
        { model: model.id, aspect: request.aspect ?? "1:1", quality: "auto", count: 1 },
        { prompt: request.prompt, references: { images: [], audio: [] } },
        signal ?? AbortSignal.timeout(DEADLINE_MS),
      );
      const files = "files" in submitted ? submitted.files : await (async () => {
        let waitMs = POLL_MS;
        for (;;) {
          if (Date.now() > deadline) throw Object.assign(new Error("The image plugin gave no picture in time"), { status: 502 });
          await wait(Math.min(waitMs, Math.max(0, deadline - Date.now())), signal);
          const state = await endpoint.status(submitted.taskId, signal ?? AbortSignal.timeout(MAX_POLL_MS));
          if (state.status === "succeeded") return state.files;
          if (state.status === "failed") throw Object.assign(new Error(state.reason), { status: 502 });
          if (state.status === "cancelled") throw Object.assign(new Error("The image plugin cancelled the picture"), { status: 409 });
          waitMs = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, state.pollAfterMs ?? POLL_MS));
        }
      })();
      const first = files[0];
      if (!first) throw Object.assign(new Error("The image plugin finished without a picture"), { status: 502 });
      const { bytes, mime } = await resultBytes(first, "image", endpoint.resultOrigin(), plugin.name);
      return { bytes, mime: mime as GeneratedImage["mime"] };
    },
  };
}
