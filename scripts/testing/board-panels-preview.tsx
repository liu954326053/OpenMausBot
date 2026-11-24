// The production board's overlay over a plain board, served only by scripts/testing/board-panels-shots.ts. The overlay
// is the real one; the board under it is a few plain cards and its backend is the overlay's test fake, so nothing
// reaches a server. Videos play the fixture clip the shots script serves at /__board-panels/sample.mp4.
// ?opened=bot:<botId>|asset:<nodeId>  &skin=midnight|daylight  &lang=zh
import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { botNodeId, type CanvasFileRef } from "../../shared/project-canvas";
import { ProductionBoardOverlay } from "../../src/components/production-board/panels/ProductionBoardOverlay";
import { boardSnapshot, fakeBackend, SAMPLE_PROJECT_ID } from "../../src/components/production-board/panels/testing/board-sample";
import { loadLocale } from "../../src/lib/i18n";
import type { BoardAnchor, BoardOpened } from "../../src/lib/production-board/overlay";
import { applySkin, SKIN_IDS, type SkinId } from "../../src/lib/skins";
import "../../src/styles.css";

interface PlainCard { id: string; title: string; meta: string; x: number; y: number; width: number; height: number }

const CARDS: PlainCard[] = [
  { id: botNodeId("board-2"), title: "镜川 EP02", meta: "分镜脚本设计师 · 等视频生成", x: 96, y: 132, width: 300, height: 196 },
  { id: "group-qingwu", title: "沈青梧", meta: "角色 · 17 岁 · 灯铺传人", x: 96, y: 372, width: 220, height: 280 },
  { id: "shot-2-3", title: "EP02 SH03 · 船影", meta: "全景 · 固定 · 4 秒", x: 360, y: 372, width: 300, height: 220 },
  { id: botNodeId("board-3"), title: "镜川 EP03", meta: "分镜脚本设计师 · 等你回答", x: 700, y: 520, width: 300, height: 196 },
];

const PICTURE_COLOURS: Record<string, [string, string]> = {
  "qingwu.png": ["#3d5a6c", "#c9a227"],
  "chenzhou.png": ["#2b2f36", "#7a5c3e"],
  "baixiansheng.png": ["#4a4a4a", "#8c1c13"],
  "aman.png": ["#5c6b4a", "#e0c27a"],
  "pier.png": ["#1f2a33", "#6b7f8c"],
  "shop.png": ["#5c3d2e", "#c9a227"],
  "lighthouse.png": ["#46606e", "#9fb4c0"],
  "street.png": ["#252a3a", "#5f6b8a"],
  "pier-end.png": ["#1c2630", "#8aa0ad"],
};

const painted = new Map<string, string>();

/** A portrait-shaped picture in the asset's colours, drawn once per file. */
function picture(file: CanvasFileRef): string {
  const known = painted.get(file.path);
  if (known) return known;
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 640;
  const pen = canvas.getContext("2d")!;
  const [ground, light] = PICTURE_COLOURS[file.name] ?? ["#3a3f47", "#8c96a3"];
  const fill = pen.createLinearGradient(0, 0, 0, 640);
  fill.addColorStop(0, light);
  fill.addColorStop(1, ground);
  pen.fillStyle = fill;
  pen.fillRect(0, 0, 480, 640);
  pen.fillStyle = "rgb(0 0 0 / 0.28)";
  pen.beginPath();
  pen.arc(240, 250, 92, 0, Math.PI * 2);
  pen.fill();
  pen.beginPath();
  pen.ellipse(240, 600, 190, 230, 0, Math.PI, 0);
  pen.fill();
  const url = canvas.toDataURL("image/png");
  painted.set(file.path, url);
  return url;
}

const fake = fakeBackend({ fileUrl: (_projectId, file) => (file.mime.startsWith("video/") ? "/__board-panels/sample.mp4" : picture(file)) });
const snapshot = boardSnapshot();

function openedFrom(value: string | null): BoardOpened | null {
  if (value?.startsWith("bot:")) return { kind: "bot", botId: value.slice(4) };
  if (value?.startsWith("asset:")) return { kind: "asset", nodeId: value.slice(6) };
  return null;
}

const listeners = new Set<() => void>();
window.addEventListener("resize", () => listeners.forEach((listener) => listener()));

function PreviewBoard({ opened: first }: { opened: BoardOpened | null }) {
  const [opened, setOpened] = useState(first);
  const anchorOf = useCallback((nodeId: string): BoardAnchor | null => {
    const card = document.querySelector(`[data-plain-card="${CSS.escape(nodeId)}"]`);
    if (!card) return null;
    const box = card.getBoundingClientRect();
    const origin = document.querySelector("[data-plain-board]")!.getBoundingClientRect();
    return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
  }, []);
  const subscribeView = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return (
    <div data-plain-board="" className="relative h-screen overflow-hidden bg-app text-ink">
      {CARDS.map((card) => (
        <div key={card.id} data-plain-card={card.id} className="absolute flex flex-col gap-1 rounded-xl border border-hairline/50 bg-card p-4" style={{ left: card.x, top: card.y, width: card.width, height: card.height }}>
          <span className="text-[13px] font-medium leading-[18px]">{card.title}</span>
          <span className="text-[12px] leading-4 text-ink-tertiary">{card.meta}</span>
        </div>
      ))}
      <ProductionBoardOverlay
        projectId={SAMPLE_PROJECT_ID}
        snapshot={snapshot}
        backend={fake.backend}
        opened={opened}
        open={setOpened}
        close={() => setOpened(null)}
        anchorOf={anchorOf}
        subscribeView={subscribeView}
        focusNode={() => undefined}
        focusEpisode={() => undefined}
        focusStage={() => undefined}
      />
    </div>
  );
}

const params = new URLSearchParams(location.search);
const skin = params.get("skin");
applySkin((SKIN_IDS as readonly string[]).includes(skin ?? "") ? skin as SkinId : "midnight");
await loadLocale(params.get("lang") ?? "zh");
createRoot(document.getElementById("root")!).render(<PreviewBoard opened={openedFrom(params.get("opened"))} />);
