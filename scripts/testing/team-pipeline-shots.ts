// Screenshots of the team map over a team's pipeline, from scripts/testing/team-pipeline-preview.tsx in a headless
// Chrome. Nothing here reaches a server: the preview fakes the pipeline routes in the page.
//   node --experimental-strip-types scripts/testing/team-pipeline-shots.ts OUT_DIR
// needs OMB_AGENT_BROWSER_PATH and AGENT_BROWSER_EXECUTABLE_PATH, as `control-omb ui launch` does.
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closeBrowserSession } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "./control-omb-ui.ts";
import { mountPreview } from "./preview-fixture.ts";

interface Shot {
  name: string;
  team: "drama" | "others" | "crowd";
  lang?: string;
  size?: [number, number];
  query?: string;
  /** Done in order before the picture: a script run in the page, a drag between two elements with the real pointer
   * (`drop: false` leaves the button down), or keys pressed on the element that has focus. */
  steps?: Array<string | { drag: [from: string, onto: string]; drop: boolean } | { keys: string[] }>;
}

const press = (selector: string) => `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("click", { bubbles: true })); true`;
const pressLabelled = (label: string) => `[...document.querySelectorAll("[aria-label]")].find((one) => one.getAttribute("aria-label") === ${JSON.stringify(label)}).dispatchEvent(new MouseEvent("click", { bubbles: true })); true`;
const focusLabelled = (label: string) => `[...document.querySelectorAll("[aria-label]")].find((one) => one.getAttribute("aria-label") === ${JSON.stringify(label)}).focus(); true`;
const pressText = (selector: string, text: string) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((one) => one.textContent.trim() === ${JSON.stringify(text)}).click(); true`;

const SHOTS: Shot[] = [
  { name: "drama", team: "drama" },
  { name: "others", team: "others" },
  { name: "drama-dot-menu", team: "drama", steps: [pressLabelled("从砚青拉一条线")] },
  { name: "drama-line-selected", team: "drama", steps: [pressLabelled("从砚青到墨白的线")] },
  { name: "drama-refused", team: "drama", steps: [pressLabelled("从青禾拉一条线"), pressText("[role=menuitemcheckbox]", "砚青")] },
  { name: "drama-dragging", team: "drama", steps: [{ drag: ['[data-pipeline-dot="yunzhou"]', '[data-bot-id="qinghe"]'], drop: false }] },
  { name: "drama-by-hand", team: "drama", steps: [{ drag: ['[data-pipeline-dot="yunzhou"]', '[data-bot-id="qinghe"]'], drop: true }] },
  { name: "drama-keyboard-line", team: "drama", steps: [focusLabelled("从砚青到墨白的线"), { keys: ["Enter"] }] },
  { name: "drama-keyboard-removed", team: "drama", steps: [focusLabelled("从砚青到墨白的线"), { keys: ["Enter", "Enter"] }] },
  { name: "drama-keyboard-menu", team: "drama", steps: [focusLabelled("从墨白拉一条线"), { keys: ["Enter", "ArrowDown"] }] },
  { name: "drama-judging-again", team: "drama", query: "judging=1", steps: [press("[data-team-key] summary"), pressText("[data-team-menu] button", "重新判定")] },
  { name: "drama-team-menu", team: "drama", steps: [press("[data-team-key] summary")] },
  { name: "others-narrow", team: "others", size: [760, 520] },
  { name: "crowd-en", team: "crowd", lang: "en" },
  { name: "crowd-en-narrow", team: "crowd", lang: "en", size: [760, 520] },
];

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: team-pipeline-shots.ts OUT_DIR");
mkdirSync(out, { recursive: true });

// agent-browser's socket lives under this home, and a socket path holds about 100 bytes: macOS's own temporary folder is too deep.
const home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-pipeline-shots-"));
mkdirSync(join(home, "tmp"), { recursive: true });
const preview = await mountPreview({ info: { url: "http://127.0.0.1:9" } }, {
  entry: "/scripts/testing/team-pipeline-preview.tsx", route: "/__team-pipeline.html", title: "Team pipeline preview", logLevel: "silent",
});
const { binary, chrome } = await ensureUiBrowser();
const env = sessionEnv({ home, session: `pipeline-${process.pid}`, chrome });
const browser = (args: string[], timeoutMs?: number) => agentBrowser(binary, env, args, timeoutMs);
try {
  for (const skin of ["midnight", "daylight"]) {
    for (const shot of SHOTS) {
      const [width, height] = shot.size ?? [1440, 900];
      await browser(["set", "viewport", String(width), String(height)]);
      await browser(["open", `${preview.previewUrl}?team=${shot.team}&skin=${skin}&lang=${shot.lang ?? "zh"}${shot.query ? `&${shot.query}` : ""}`], 120_000);
      await browser(["wait", "[data-pipeline-card]"], 60_000).catch(async (error: unknown) => {
        const said = await Promise.all([browser(["errors"]), browser(["console"])]).catch(() => []);
        throw new Error(`${shot.name}: the map never drew its pipeline. ${JSON.stringify(said).slice(0, 4000)}`, { cause: error });
      });
      for (const step of shot.steps ?? []) {
        if (typeof step === "string") await browser(["eval", step]);
        else if ("keys" in step) for (const key of step.keys) await browser(["press", key]);
        else {
          const centres = await browser(["eval", `JSON.stringify(${JSON.stringify(step.drag)}.map((selector) => { const box = document.querySelector(selector).getBoundingClientRect(); return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)]; }))`]);
          const [[fromX, fromY], [ontoX, ontoY]] = JSON.parse(String(centres.result)) as [[number, number], [number, number]];
          await browser(["mouse", "move", String(fromX), String(fromY)]);
          await browser(["mouse", "down"]);
          for (const part of [0.3, 0.7, 1]) await browser(["mouse", "move", String(Math.round(fromX + (ontoX - fromX) * part)), String(Math.round(fromY + (ontoY - fromY) * part))]);
          if (step.drop) await browser(["mouse", "up"]);
        }
        await browser(["wait", "400"]);
      }
      await browser(["wait", "400"]);
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
