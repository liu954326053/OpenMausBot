// Screenshots of the production board's overlay, from scripts/testing/board-panels-preview.tsx in a headless Chrome.
// Nothing here reaches a server: the preview fakes the board's backend in the page.
//   node --experimental-strip-types scripts/testing/board-panels-shots.ts OUT_DIR
// needs OMB_AGENT_BROWSER_PATH and AGENT_BROWSER_EXECUTABLE_PATH, as `control-omb ui launch` does.
import { createReadStream, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closeBrowserSession } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "./control-omb-ui.ts";
import { mountPreview, REPO_ROOT } from "./preview-fixture.ts";

interface Shot {
  name: string;
  /** `bot:<botId>` or `asset:<nodeId>`. */
  opened?: string;
  lang?: string;
  size?: [number, number];
  /** Scripts run in the page, in order, before the picture. */
  steps?: string[];
}

const SMALL: [number, number] = [760, 560];
const pressLabelled = (label: string) => `[...document.querySelectorAll("[aria-label]")].find((one) => one.getAttribute("aria-label") === ${JSON.stringify(label)}).click(); true`;
const pressText = (selector: string, text: string) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((one) => one.textContent.trim() === ${JSON.stringify(text)}).click(); true`;
const tab = (name: string) => pressText("[role=tab]", name);
const unfoldShots = (episode: string) => `[...document.querySelectorAll("[data-board-side-panel] button[aria-expanded=false]")].find((one) => one.textContent.includes(${JSON.stringify(episode)})).click(); true`;
const unfold = pressLabelled("展开团队与素材");
const addReference = `document.querySelector("[data-board-chat] [data-reference-add]").click(); true`;

const SHOTS: Shot[] = [
  { name: "team" },
  { name: "assets", steps: [tab("素材分类"), unfoldShots("EP02")] },
  { name: "episodes", steps: [tab("分集")] },
  { name: "folded", steps: [pressLabelled("收起团队与素材")] },
  { name: "chat", opened: "bot:board-2" },
  { name: "chat-docked", opened: "bot:lead" },
  { name: "chat-picker", opened: "bot:board-2", steps: [addReference] },
  { name: "chat-waiting", opened: "bot:board-3" },
  { name: "details-character", opened: "asset:group-qingwu" },
  { name: "details-shot", opened: "asset:shot-1-3" },
  { name: "details-shot-paper", opened: "asset:shot-3-1" },
  { name: "details-video", opened: "asset:take-1-3-1" },
  { name: "team-small", size: SMALL, steps: [unfold] },
  { name: "assets-small", size: SMALL, steps: [unfold, tab("素材分类"), unfoldShots("EP01")] },
  { name: "episodes-small", size: SMALL, steps: [unfold, tab("分集")] },
  { name: "folded-small", size: SMALL },
  { name: "chat-small", size: SMALL, opened: "bot:board-2" },
  { name: "chat-docked-small", size: SMALL, opened: "bot:lead" },
  { name: "chat-picker-small", size: SMALL, opened: "bot:board-2", steps: [addReference] },
  { name: "chat-sheet", size: [760, 520], opened: "bot:board-2" },
  { name: "details-character-small", size: SMALL, opened: "asset:group-qingwu" },
  { name: "details-shot-small", size: SMALL, opened: "asset:shot-1-3" },
  { name: "details-video-small", size: SMALL, opened: "asset:take-1-3-1" },
  { name: "team-en", lang: "en" },
  { name: "chat-en", lang: "en", opened: "bot:board-2" },
  { name: "details-shot-en", lang: "en", opened: "asset:shot-1-3" },
];

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: board-panels-shots.ts OUT_DIR");
mkdirSync(out, { recursive: true });

// agent-browser's socket lives under this home, and a socket path holds about 100 bytes: macOS's own temporary folder is too deep.
const home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-board-panels-shots-"));
mkdirSync(join(home, "tmp"), { recursive: true });
const preview = await mountPreview({ info: { url: "http://127.0.0.1:9" } }, {
  entry: "/scripts/testing/board-panels-preview.tsx", route: "/__board-panels.html", title: "Production board panels preview", logLevel: "silent",
  extraRoutes: [{
    path: "/__board-panels/sample.mp4",
    handler: (_request, response) => {
      response.setHeader("content-type", "video/mp4");
      createReadStream(join(REPO_ROOT, "server/testing/fixtures/generation-sample.mp4")).pipe(response);
    },
  }],
});
const { binary, chrome } = await ensureUiBrowser();
const env = sessionEnv({ home, session: `board-panels-${process.pid}`, chrome });
const browser = (args: string[], timeoutMs?: number) => agentBrowser(binary, env, args, timeoutMs);
try {
  for (const skin of ["midnight", "daylight"]) {
    for (const shot of SHOTS) {
      const [width, height] = shot.size ?? [1440, 900];
      await browser(["set", "viewport", String(width), String(height)]);
      const opened = shot.opened ? `&opened=${encodeURIComponent(shot.opened)}` : "";
      await browser(["open", `${preview.previewUrl}?skin=${skin}&lang=${shot.lang ?? "zh"}${opened}`], 120_000);
      const ready = shot.opened?.startsWith("asset:") ? "[data-board-asset]" : shot.opened ? "[data-board-chat]" : "[data-board-overlay]";
      await browser(["wait", ready], 60_000).catch(async (error: unknown) => {
        const said = await Promise.all([browser(["errors"]), browser(["console"])]).catch(() => []);
        throw new Error(`${shot.name}: the overlay never drew. ${JSON.stringify(said).slice(0, 4000)}`, { cause: error });
      });
      for (const step of shot.steps ?? []) {
        await browser(["eval", step]);
        await browser(["wait", "400"]);
      }
      await browser(["wait", shot.opened?.startsWith("asset:shot") ? "1200" : "500"]);
      const file = join(out, `${shot.name}-${skin}.png`);
      await browser(["screenshot", file], 60_000);
      process.stdout.write(`${file} ${statSync(file).size}\n`);
    }
  }
} finally {
  if (!await closeBrowserSession(binary, env)) await browser(["close"], 15_000).catch(() => {});
  await preview.close();
  await removeTempDir(home);
}
