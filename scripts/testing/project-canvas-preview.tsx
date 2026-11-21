// The project canvas on the in-memory backend with the sample project, for screenshots: it wears the daylight skin
// unless ?skin= names another, and ?bot=<id> opens the canvas on that bot. Images are painted and videos recorded in
// the page, so the preview needs no server and no files.
import { createRoot } from "react-dom/client";
import type { StartGenerationInput } from "../../shared/project-generation";
import { ProjectCanvas } from "../../src/components/project-canvas/ProjectCanvas";
import type { MemoryGenerationOutput } from "../../src/lib/project-canvas/memory-backend";
import { SAMPLE_IMAGE_PATH, SAMPLE_PROJECT_ID, SAMPLE_VIDEO_PATH, sampleCanvasBackend } from "../../src/testing/project-canvas-sample";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.skin = params.get("skin") ?? "daylight";

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

const backend = sampleCanvasBackend({
  fileUrls: { [SAMPLE_IMAGE_PATH]: paintImage(1536, 1024, 230), [SAMPLE_VIDEO_PATH]: firstTake },
  output,
  delayMs: 1500,
});
Object.assign(window, { projectCanvasBackend: backend });

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh" }}>
    <ProjectCanvas
      projectId={SAMPLE_PROJECT_ID}
      backend={backend}
      selectedBotId={params.get("bot") ?? undefined}
      topBarSlot={<span className="ui-chip">Team changed: Otto joined</span>}
    />
  </div>,
);
