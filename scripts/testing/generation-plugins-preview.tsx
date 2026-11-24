import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GenerationPluginsPanel } from "../../src/components/GenerationPluginsPanel";
import { ProjectSettingsDialog } from "../../src/components/project-canvas/ProjectSettingsDialog";
import { CanvasUiContext } from "../../src/components/project-canvas/canvas-ui";
import type { CanvasController } from "../../src/lib/project-canvas/controller";
import type { CanvasState } from "@/lib/project-canvas/controller";
import type { CanvasSnapshot } from "../../shared/project-canvas";
import type { GenerationModel, GenerationSettingsWire } from "../../shared/project-generation";
import { applySkin } from "../../src/lib/skins";
import { loadLocale, setLocale } from "../../src/lib/i18n";
import "../../src/styles.css";

const PLUGIN_ID = "acme-images";

const image: GenerationModel = {
  id: "pixel-1", name: "Pixel 1", kind: "image", aspects: ["1:1", "16:9", "9:16"], qualities: ["standard", "hd"], maxCount: 4,
  referenceImages: true, referenceAudio: false,
};
const video: GenerationModel = {
  id: "motion-1", name: "Motion 1", kind: "video", resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16"], durations: [5, 10],
  referenceImages: true, referenceAudio: true,
};

const wire: GenerationSettingsWire = {
  settings: {
    image: { plugin: PLUGIN_ID, server: null, tools: { listModels: "list_models", generate: "generate_image", taskStatus: "task_status", cancelTask: "cancel_task" }, defaults: { model: "pixel-1", aspect: "16:9", quality: "hd", count: 2 } },
    video: { plugin: null, server: null, tools: { listModels: "list_models", generate: "generate_video", taskStatus: "task_status", cancelTask: "cancel_task" }, defaults: { model: "", resolution: "720p", aspect: "16:9", seconds: 5 } },
    concurrency: { episodes: 2, videos: 2, images: 4 },
  },
  servers: [],
  plugins: [{
    id: PLUGIN_ID, name: "Acme Images", version: "1.0.0", description: "Sample plugin", kinds: ["image", "video"],
    models: [image, video], enabled: true, configured: true, values: { baseUrl: "https://api.acme.test/v1" }, secrets: ["apiKey"], installedAt: Date.now(),
    fields: [
      { key: "baseUrl", label: "API address", type: "url", required: true, default: "https://api.acme.test/v1" },
      { key: "apiKey", label: "API key", type: "secret", required: true },
    ],
  }],
};

const snapshot = { projectId: "demo", revision: 1, readOnly: false, nodes: [], connections: [], bots: {}, settings: {} } as unknown as CanvasSnapshot;

const state: CanvasState = { phase: "ready", snapshot, looks: {}, generation: wire, models: { image: [image], video: [video] }, modelsRefused: {}, writing: {}, replies: [] };

const controller = {
  previewModels: async (kind: "image" | "video") => ({ models: (kind === "image" ? [image] : [video]) }),
  saveGeneration: async () => null,
} as unknown as CanvasController;

function Preview() {
  const query = new URLSearchParams(location.search);
  const [view, setView] = useState<"plugins" | "settings">(query.get("view") === "settings" ? "settings" : "plugins");
  const [skin, setSkin] = useState<"midnight" | "daylight">(query.get("skin") === "daylight" ? "daylight" : "midnight");
  useEffect(() => { applySkin(skin); }, [skin]);
  return (
    <main className="min-h-screen bg-app p-6 text-ink">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[20px] font-semibold leading-7 tracking-[-0.01em]">Isolated preview · generation plugins</h1>
          <div className="flex gap-1">
            <button type="button" className="ui-button ui-button-sm" onClick={() => { setSkin("midnight"); applySkin("midnight"); }}>Midnight</button>
            <button type="button" className="ui-button ui-button-sm" onClick={() => { setSkin("daylight"); applySkin("daylight"); }}>Daylight</button>
            <button type="button" className="ui-button ui-button-sm" onClick={() => setView("plugins")}>Plugins</button>
            <button type="button" className="ui-button ui-button-sm" onClick={() => setView("settings")}>Project settings</button>
          </div>
        </div>
        <p className="text-[12px] text-ink-tertiary" data-preview-skin={skin}>Sample plugin over a sample API. No real key is stored or sent.</p>
        {view === "plugins" ? (
          <div className="rounded-2xl border border-hairline/40 bg-card p-5">
            <GenerationPluginsPanel initialOpenId={query.get("open") ?? undefined} />
          </div>
        ) : (
          <CanvasUiContext.Provider value={{ controller, state, snapshot, readOnly: false, panelNodeId: null }}>
            <ProjectSettingsDialog onClose={() => setView("plugins")} />
          </CanvasUiContext.Provider>
        )}
      </div>
    </main>
  );
}

void loadLocale("zh").then(() => {
  setLocale("zh");
  applySkin("midnight");
  createRoot(document.getElementById("root")!).render(<Preview />);
});
