// Screenshots of the sidebar over dramas of 60 episodes, from scripts/testing/sidebar-episodes-preview.tsx, and of the
// project settings with the production's counts, from scripts/testing/project-canvas-preview.tsx, in a headless Chrome.
// Nothing here reaches a server: both previews fake theirs in the page.
//   node --experimental-strip-types scripts/testing/sidebar-episodes-shots.ts OUT_DIR [NAME_PREFIX]
// needs OMB_AGENT_BROWSER_PATH and AGENT_BROWSER_EXECUTABLE_PATH, as `control-omb ui launch` does.
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closeBrowserSession } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "./control-omb-ui.ts";
import { mountPreview, REPO_ROOT } from "./preview-fixture.ts";

type Page = "sidebar" | "settings";

interface Shot {
  name: string;
  page: Page;
  lang?: string;
  mode?: "simple";
  size?: [number, number];
  /** Scripts run in the page, in order, before the picture. */
  steps: Array<(lang: string) => string>;
}

const said = (lang: string, key: string): string => {
  const pack = JSON.parse(readFileSync(join(REPO_ROOT, "src", "locales", `${lang}.json`), "utf8")) as Record<string, string>;
  const english = JSON.parse(readFileSync(join(REPO_ROOT, "src", "locales", "en.json"), "utf8")) as Record<string, string>;
  return pack[key] ?? english[key]!;
};
const press = (selector: string) => () => `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("click", { bubbles: true })); true`;
const timed = (selector: string) => () =>
  `(() => { window.__took = null; const start = performance.now(); document.querySelector(${JSON.stringify(selector)}).click(); setTimeout(() => { window.__took = Math.round(performance.now() - start); }, 0); return true; })()`;
const centre = (selector: string) => () => `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" }); true`;

const drama = '[data-sidebar-team-project="rain"]';
const openProject = press('[data-sidebar-project-row="rain"]');
const openEpisodes = press(`${drama} [data-sidebar-project-episodes-row]`);
const openEpisode = (number: number) => press(`${drama} [data-sidebar-project-episode-row="${number}"]`);
const openBot = (id: string) => press(`[data-sidebar-project-bot="${id}"]`);
const openSettings = (lang: string) => `document.querySelector(${JSON.stringify(`button[aria-label="${said(lang, "projectCanvas.settings.projectTitle")}"]`)}).click(); true`;
const showCounts = centre("[data-project-settings-counts]");
const typeImages = (typed: string) => (lang: string) => `(() => {
  const label = [...document.querySelectorAll("[data-project-settings-counts] label")].find((one) => one.textContent === ${JSON.stringify(said(lang, "projectSettings.images"))});
  const field = document.getElementById(label.htmlFor);
  field.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(typed)});
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.blur();
  return true;
})()`;

const SMALL: [number, number] = [760, 520];
const toEpisodeBot = [openProject, openEpisodes, openEpisode(2), openBot("rain-post-2")];
const SHOTS: Shot[] = [
  { name: "sidebar-folded", page: "sidebar", steps: [openProject] },
  { name: "sidebar-episodes", page: "sidebar", steps: [openProject, timed(`${drama} [data-sidebar-project-episodes-row]`)] },
  { name: "sidebar-episode-open", page: "sidebar", steps: toEpisodeBot },
  { name: "sidebar-selected-folded", page: "sidebar", steps: [...toEpisodeBot, openEpisode(2), openEpisodes] },
  { name: "sidebar-episodes-end", page: "sidebar", steps: [openProject, openEpisodes, centre(`${drama} [data-sidebar-project-episode-row="60"]`)] },
  { name: "sidebar-simple", page: "sidebar", mode: "simple", steps: toEpisodeBot },
  { name: "sidebar-en", page: "sidebar", lang: "en", steps: toEpisodeBot },
  { name: "sidebar-small", page: "sidebar", size: SMALL, steps: [...toEpisodeBot, centre('[data-sidebar-project-bot="rain-post-2"]')] },
  { name: "sidebar-small-folded", page: "sidebar", size: SMALL, steps: [...toEpisodeBot, openEpisode(2), openEpisodes, centre(`${drama} [data-sidebar-project-episodes-row]`)] },
  { name: "settings", page: "settings", steps: [openSettings, showCounts] },
  { name: "settings-invalid", page: "settings", steps: [openSettings, typeImages("51"), showCounts] },
  { name: "settings-en", page: "settings", lang: "en", steps: [openSettings, typeImages("0"), showCounts] },
  { name: "settings-small", page: "settings", size: SMALL, steps: [openSettings, showCounts] },
];

const READY: Record<Page, (lang: string) => string> = {
  sidebar: () => '[data-sidebar-project-row="rain"]',
  settings: (lang) => `button[aria-label="${said(lang, "projectCanvas.settings.projectTitle")}"]`,
};

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: sidebar-episodes-shots.ts OUT_DIR [NAME_PREFIX]");
const only = process.argv[3];
const shots = only ? SHOTS.filter((shot) => shot.name.startsWith(only)) : SHOTS;
mkdirSync(out, { recursive: true });

// agent-browser's socket lives under this home, and a socket path holds about 100 bytes: macOS's own temporary folder is too deep.
const home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-episodes-shots-"));
mkdirSync(join(home, "tmp"), { recursive: true });
const noServer = { info: { url: "http://127.0.0.1:9" } };
const previews = {
  sidebar: await mountPreview(noServer, { entry: "/scripts/testing/sidebar-episodes-preview.tsx", route: "/__sidebar-episodes.html", title: "Sidebar episodes preview", logLevel: "silent" }),
  settings: await mountPreview(noServer, { entry: "/scripts/testing/project-canvas-preview.tsx", route: "/__project-canvas.html", title: "Project canvas preview", logLevel: "silent" }),
};
const { binary, chrome } = await ensureUiBrowser();
const env = sessionEnv({ home, session: `episodes-${process.pid}`, chrome });
const browser = (args: string[], timeoutMs?: number) => agentBrowser(binary, env, args, timeoutMs);
try {
  for (const skin of ["midnight", "daylight"]) {
    for (const shot of shots) {
      const lang = shot.lang ?? "zh";
      const [width, height] = shot.size ?? [1440, 900];
      await browser(["set", "viewport", String(width), String(height)]);
      await browser(["open", `${previews[shot.page].previewUrl}?skin=${skin}&lang=${lang}${shot.mode ? `&mode=${shot.mode}` : ""}`], 120_000);
      await browser(["wait", READY[shot.page](lang)], 60_000).catch(async (error: unknown) => {
        const told = await Promise.all([browser(["errors"]), browser(["console"])]).catch(() => []);
        throw new Error(`${shot.name}: the page never drew. ${JSON.stringify(told).slice(0, 4000)}`, { cause: error });
      });
      await browser(["wait", "400"]);
      for (const step of shot.steps) {
        await browser(["eval", step(lang)]);
        await browser(["wait", "300"]);
      }
      await browser(["wait", "400"]);
      const took = await browser(["eval", "JSON.stringify(window.__took ?? null)"]);
      const file = join(out, `${shot.name}-${skin}.png`);
      await browser(["screenshot", file], 60_000);
      const errors = await browser(["errors"]);
      process.stdout.write(`${file} ${statSync(file).size}${took.result && took.result !== "null" ? ` unfolded in ${String(took.result)}ms` : ""} ${JSON.stringify(errors).slice(0, 400)}\n`);
    }
  }
} finally {
  if (!await closeBrowserSession(binary, env)) await browser(["close"], 15_000).catch(() => {});
  await previews.sidebar.close();
  await previews.settings.close();
  await removeTempDir(home);
}
