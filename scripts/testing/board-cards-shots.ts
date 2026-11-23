// Screenshots of every production board card, from scripts/testing/board-cards-preview.tsx in a headless Chrome, in
// both skins at a normal and a small window. Nothing here reaches a server.
//   node --experimental-strip-types scripts/testing/board-cards-shots.ts OUT_DIR
// needs OMB_AGENT_BROWSER_PATH and AGENT_BROWSER_EXECUTABLE_PATH, as `control-omb ui launch` does. Only one UI fixture
// may be up at a time across worktrees: it holds /tmp/omb-ui-fixture.lock while its preview is up.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { closeBrowserSession } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "./control-omb-ui.ts";
import { mountPreview } from "./preview-fixture.ts";

const LOCK = "/tmp/omb-ui-fixture.lock";
const OWNER = `pb-cards ${process.pid}`;

interface Shot {
  name: string;
  only?: string;
  lang?: string;
  size?: [number, number];
  /** Only what the window shows, not the whole page. */
  windowOnly?: boolean;
  /** Elements clicked with the real pointer before the picture. */
  clicks?: string[];
}

const SECTIONS = ["bots", "documents", "assets", "shots", "results", "finals", "generic", "far"];
const WORDY = ["bots", "documents", "assets", "shots", "results", "finals"];

const SHOTS: Shot[] = [
  { name: "all" },
  { name: "all-small", size: [760, 560] },
  ...["bots", "assets", "results", "finals"].map((only) => ({ name: `section-${only}-small`, only, size: [760, 560] as [number, number], windowOnly: true })),
  ...SECTIONS.map((only) => ({ name: `section-${only}`, only })),
  ...WORDY.map((only) => ({ name: `section-${only}-en`, only, lang: "en" })),
  { name: "result-playing", only: "results", clicks: ['[aria-label="播放 SH03 青梧点灯"]'] },
  { name: "result-other-take", only: "results", clicks: ['[data-result-take][title="第 1 版"]'] },
];

function lockOwner(): string | null {
  try {
    return readFileSync(join(LOCK, "owner"), "utf8").split("\n")[0] ?? "";
  } catch {
    return null;
  }
}

function lockIsStale(): boolean {
  const pid = lockOwner()?.split(" ")[1];
  if (!pid || !/^\d+$/.test(pid)) return false;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function takeLock(): Promise<void> {
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "owner"), `${OWNER}\n`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (lockIsStale()) {
      process.stdout.write(`removing the stale lock of ${lockOwner()}\n`);
      rmSync(LOCK, { recursive: true, force: true });
      continue;
    }
    process.stdout.write(`waiting for ${LOCK}, held by ${lockOwner() ?? "someone"}\n`);
    await sleep(10_000);
  }
}

const releaseLock = () => {
  if (lockOwner() === OWNER) rmSync(LOCK, { recursive: true, force: true });
};

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: board-cards-shots.ts OUT_DIR");
mkdirSync(out, { recursive: true });

await takeLock();
// agent-browser's socket lives under this home, and a socket path holds about 100 bytes: macOS's own temporary folder is too deep.
const home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-board-cards-shots-"));
try {
  mkdirSync(join(home, "tmp"), { recursive: true });
  const preview = await mountPreview({ info: { url: "http://127.0.0.1:9" } }, {
    entry: "/scripts/testing/board-cards-preview.tsx", route: "/__board-cards.html", title: "Board cards preview", logLevel: "silent",
  });
  const { binary, chrome } = await ensureUiBrowser();
  const env = sessionEnv({ home, session: `board-cards-${process.pid}`, chrome });
  const browser = (args: string[], timeoutMs?: number) => agentBrowser(binary, env, args, timeoutMs);
  try {
    for (const skin of ["midnight", "daylight"]) {
      for (const shot of SHOTS) {
        const [width, height] = shot.size ?? [1440, 900];
        await browser(["set", "viewport", String(width), String(height)]);
        await browser(["open", `${preview.previewUrl}?skin=${skin}&lang=${shot.lang ?? "zh"}${shot.only ? `&only=${shot.only}` : ""}`], 120_000);
        await browser(["wait", "[data-board-card], [data-board-far]"], 60_000).catch(async (error: unknown) => {
          const said = await Promise.all([browser(["errors"]), browser(["console"])]).catch(() => []);
          throw new Error(`${shot.name}: the preview never drew its cards. ${JSON.stringify(said).slice(0, 4000)}`, { cause: error });
        });
        for (const selector of shot.clicks ?? []) {
          await browser(["click", selector]);
          await browser(["wait", "800"]);
        }
        await browser(["wait", "500"]);
        const file = join(out, `${shot.name}-${skin}.png`);
        await browser(["screenshot", file, ...(shot.windowOnly ? [] : ["--full"])], 60_000);
        process.stdout.write(`${file} ${statSync(file).size}\n`);
      }
    }
  } finally {
    if (!await closeBrowserSession(binary, env)) await browser(["close"], 15_000).catch(() => {});
    await preview.close();
  }
} finally {
  await removeTempDir(home);
  releaseLock();
}
