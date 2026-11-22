// The project canvas on the in-memory backend with a sample project, for screenshots: it wears the daylight skin unless
// ?skin= names another, speaks ?lang=, and ?bot=<id> opens the canvas on that bot. ?sample=drama is the drama project
// with its whole pipeline, at ?moment=confirm|generating|failed|finished, with ?film=1 for the finished film on the
// canvas and ?draft=none|written|kept|not-installed|unsupported-version|remote for the post bot's draft; ?opens=app has
// JianYing come up without the draft, ?name= names the draft, and ?pick=1 lets the page tell where a picked file is, as
// the desktop app does. ?view=x,y,k opens either sample on that view instead of fitting it.
// Images are painted and videos recorded in the page, so the preview needs no server and no files.
import { createRoot } from "react-dom/client";
import type { CanvasSnapshot } from "../../shared/project-canvas";
import type { ProjectDraftWire } from "../../shared/project-draft";
import type { StartGenerationInput } from "../../shared/project-generation";
import { ProjectCanvas } from "../../src/components/project-canvas/ProjectCanvas";
import { loadLocale } from "../../src/lib/i18n";
import type { MemoryCanvasOptions, MemoryGenerationOutput } from "../../src/lib/project-canvas/memory-backend";
import { DRAMA_EXPORT_FOLDER, dramaCanvasBackend, dramaCanvasSnapshot, type DramaMoment } from "../../src/testing/project-canvas-drama-sample";
import { SAMPLE_IMAGE_PATH, SAMPLE_VIDEO_PATH, sampleCanvasBackend, sampleCanvasSnapshot } from "../../src/testing/project-canvas-sample";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.skin = params.get("skin") ?? "daylight";
await loadLocale(params.get("lang") ?? "en");

function paintCity(context: CanvasRenderingContext2D, width: number, height: number, hue: number, time: number) {
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsl(${hue} 45% 12%)`);
  sky.addColorStop(1, `hsl(${hue + 30} 55% 28%)`);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < width; ) {
    const w = width * (0.05 + random() * 0.08);
    const h = height * (0.3 + random() * 0.55);
    context.fillStyle = `hsl(${hue} 30% ${8 + random() * 6}%)`;
    context.fillRect(x, height - h, w, h);
    for (let wy = height - h + 10; wy < height - 12; wy += 16) {
      for (let wx = x + 6; wx < x + w - 8; wx += 12) {
        if (random() > 0.55) continue;
        context.fillStyle = `hsl(${40 + random() * 20} 90% ${55 + random() * 20}%)`;
        context.fillRect(wx, wy, 5, 8);
      }
    }
    x += w + 2;
  }
  context.strokeStyle = "rgba(200, 220, 255, 0.35)";
  context.lineWidth = 1;
  for (let index = 0; index < 160; index += 1) {
    const x = (random() * width + time * 90) % width;
    const y = (random() * height + time * 400) % height;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - 4, y + 14);
    context.stroke();
  }
}

function paintImage(width: number, height: number, hue: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paintCity(canvas.getContext("2d")!, width, height, hue, 0);
  return canvas.toDataURL("image/png");
}

async function recordVideo(hue: number, seconds: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d")!;
  const started = performance.now();
  const draw = () => paintCity(context, canvas.width, canvas.height, hue, (performance.now() - started) / 1000);
  draw();
  const recorder = new MediaRecorder(canvas.captureStream(24), { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const timer = setInterval(draw, 1000 / 24);
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  recorder.stop();
  clearInterval(timer);
  await stopped;
  const reader = new FileReader();
  const read = new Promise<string>((resolve) => { reader.onload = () => resolve(String(reader.result)); });
  reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
  return read;
}

const firstTake = await recordVideo(220, 1.2);
const secondTake = await recordVideo(280, 1.2);
let made = 0;
const output = (input: StartGenerationInput, index: number): MemoryGenerationOutput => {
  made += 1;
  if (input.kind === "video") {
    return { file: { path: `产出/视频/${input.name ?? "shot"}-${made}.webm`, mime: "video/webm", bytes: 480_000, name: `${input.name ?? "shot"}-${made}.webm` }, url: secondTake, naturalWidth: 640, naturalHeight: 360, durationMs: 5000 };
  }
  return { file: { path: `产出/图片/${input.name ?? "image"}-${made}.png`, mime: "image/png", bytes: 900_000, name: `${input.name ?? "image"}-${made}.png` }, url: paintImage(768, 432, 200 + index * 40), naturalWidth: 768, naturalHeight: 432 };
};

function draftOf(state: string | null): Omit<ProjectDraftWire, "exportFolder"> | undefined {
  switch (state) {
    case "none": return { state: "none" };
    case "written": return { state: "written", name: params.get("name") ?? "雨城 · 第一集", writtenAt: Date.UTC(2026, 10, 22, 9, 58) };
    case "kept": return { state: "kept", name: params.get("name") ?? "雨城 · 第一集 2", writtenAt: Date.UTC(2026, 10, 22, 10, 30) };
    case "not-installed":
    case "unsupported-version":
    case "remote": return { state: "unavailable", reason: state };
    default: return undefined;
  }
}

/** The file a page picks as the finished film, which the page can then play. */
const FILM_NAME = "雨城 · 第一集.mp4";

function viewed(snapshot: CanvasSnapshot): CanvasSnapshot {
  const [x, y, k] = (params.get("view") ?? "").split(",").map(Number);
  return x !== undefined && y !== undefined && k ? { ...snapshot, viewport: { x, y, k } } : snapshot;
}

function dramaBackend() {
  const sample = { moment: (params.get("moment") ?? "finished") as DramaMoment, draft: draftOf(params.get("draft")), film: params.has("film") };
  const snapshot = viewed(dramaCanvasSnapshot(sample));
  const files = snapshot.nodes.flatMap((node) => (node.metadata?.file ? [node.metadata.file] : []));
  const fileUrls = Object.fromEntries(files.map((file, index) => [file.path, file.mime.startsWith("image/") ? paintImage(768, 512, 200 + index * 47) : index % 2 ? secondTake : firstTake]));
  const options: Partial<MemoryCanvasOptions> = { snapshot, fileUrls: { [`产出/${FILM_NAME}`]: firstTake, ...fileUrls }, output, delayMs: 1500 };
  if (params.get("opens") === "app") options.draftOpens = "app";
  if (params.has("pick")) options.localPathOf = (file) => `${file.name.startsWith("out-") ? "/Users/demo/Movies" : DRAMA_EXPORT_FOLDER}/${file.name}`;
  return dramaCanvasBackend(sample, options);
}

const drama = params.get("sample") === "drama";
const backend = drama
  ? dramaBackend()
  : sampleCanvasBackend({
    snapshot: viewed(sampleCanvasSnapshot()),
    fileUrls: { [SAMPLE_IMAGE_PATH]: paintImage(1536, 1024, 230), [SAMPLE_VIDEO_PATH]: firstTake },
    output,
    delayMs: 1500,
  });
Object.assign(window, { projectCanvasBackend: backend });

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh" }}>
    <ProjectCanvas
      projectId={backend.current().project.id}
      backend={backend}
      selectedBotId={params.get("bot") ?? undefined}
      topBarSlot={drama ? undefined : <span className="ui-chip">Team changed: Otto joined</span>}
    />
  </div>,
);
