// The project canvas on the in-memory backend, for screenshots and timing: the production board's sample drama part-way
// through its production, ?episodes= long (60 unless named), or ?empty=1 before its plan; ?sample=basic is a project
// made before productions. It wears the daylight skin unless ?skin= names another, speaks ?lang=, and ?bot=<id> opens
// the board on that bot. window.boardOpenedMs is how long the board took from being mounted to its first painted cards.
// Pictures are painted and clips recorded in the page, so the preview needs no server and no files.
import { createRoot } from "react-dom/client";
import type { CanvasFileRef, CanvasSnapshot } from "../../shared/project-canvas";
import type { StartGenerationInput } from "../../shared/project-generation";
import { ProjectCanvas } from "../../src/components/project-canvas/ProjectCanvas";
import { ProductionBoardOverlay } from "../../src/components/production-board/panels/ProductionBoardOverlay";
import { loadLocale } from "../../src/lib/i18n";
import type { MemoryGenerationOutput } from "../../src/lib/project-canvas/memory-backend";
import { productionBoardBackend, productionBoardSample } from "../../src/testing/production-board-sample";
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
const pictures = [200, 247, 294, 341].map((hue) => paintImage(384, 256, hue));
let made = 0;
const output = (input: StartGenerationInput, index: number): MemoryGenerationOutput => {
  made += 1;
  if (input.kind === "video") {
    return { file: { path: `产出/视频/${input.name ?? "shot"}-${made}.webm`, mime: "video/webm", bytes: 480_000, name: `${input.name ?? "shot"}-${made}.webm` }, url: secondTake, naturalWidth: 640, naturalHeight: 360, durationMs: 5000 };
  }
  return { file: { path: `产出/图片/${input.name ?? "image"}-${made}.png`, mime: "image/png", bytes: 900_000, name: `${input.name ?? "image"}-${made}.png` }, url: pictures[index % pictures.length]!, naturalWidth: 384, naturalHeight: 256 };
};

function fileUrls(snapshot: CanvasSnapshot): Record<string, string> {
  const files = snapshot.nodes.flatMap((node): CanvasFileRef[] => (node.metadata?.file ? [node.metadata.file] : []));
  return Object.fromEntries(files.map((file, index) => [file.path, file.mime.startsWith("image/") ? pictures[index % pictures.length]! : index % 2 ? secondTake : firstTake]));
}

function dramaBackend() {
  const snapshot = productionBoardSample({ episodes: Number(params.get("episodes") ?? 60), empty: params.has("empty") });
  return productionBoardBackend({}, { snapshot, fileUrls: fileUrls(snapshot), output, delayMs: 1500 });
}

const basic = params.get("sample") === "basic";
const backend = basic
  ? sampleCanvasBackend({ snapshot: sampleCanvasSnapshot(), fileUrls: { [SAMPLE_IMAGE_PATH]: paintImage(1536, 1024, 230), [SAMPLE_VIDEO_PATH]: firstTake }, output, delayMs: 1500 })
  : dramaBackend();
Object.assign(window, { projectCanvasBackend: backend });

const root = document.getElementById("root")!;
const mounted = performance.now();
new MutationObserver((_, observer) => {
  if (!root.querySelector("[data-board-card-id]")) return;
  observer.disconnect();
  requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(window, { boardOpenedMs: performance.now() - mounted })));
}).observe(root, { childList: true, subtree: true });
createRoot(root).render(
  <div style={{ height: "100vh" }}>
    <ProjectCanvas projectId={backend.current().project.id} backend={backend} selectedBotId={params.get("bot") ?? undefined} overlay={ProductionBoardOverlay} />
  </div>,
);
