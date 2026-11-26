// Times the production board's overlay over pb-bench's drama: builds scripts/testing/board-panels-bench-page.tsx on
// React's profiling build, as scripts/bench-desktop.ts builds the app, opens it in a headless Chrome and writes what
// the page measured to OUT_FILE as JSON. Nothing here reaches a server but the page's own. With REV, the overlay's
// files are built as they were at that commit; the page and its sample stay as they are.
//   node --experimental-strip-types scripts/testing/board-panels-bench.ts OUT_FILE [REV]
// needs OMB_AGENT_BROWSER_PATH and AGENT_BROWSER_EXECUTABLE_PATH, as `control-omb ui launch` does.
import { execFileSync } from "node:child_process";
import { createReadStream, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { closeBrowserSession } from "../../server/browser-engine.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "./control-omb-ui.ts";
import { REPO_ROOT } from "./preview-fixture.ts";

interface Drawn {
  ms: number;
  selfMs: number;
  components: number;
  byName: Record<string, number>;
}

const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: board-panels-bench.ts OUT_FILE [REV]");
mkdirSync(dirname(out), { recursive: true });
const revision = process.argv[3];
const OVERLAY_DIR = "src/components/production-board/panels/";

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const ms = (value: number) => `${value.toFixed(2)}ms`;
const line = (label: string, runs: readonly Drawn[]) =>
  `${label}: first ${ms(runs[0]?.ms ?? 0)} (own ${ms(runs[0]?.selfMs ?? 0)}), median ${ms(median(runs.map((run) => run.ms)))} (own ${ms(median(runs.map((run) => run.selfMs)))}), components ${median(runs.map((run) => run.components))}`;

async function buildPage(outDir: string) {
  const { build } = await import("vite");
  await build({
    configFile: join(REPO_ROOT, "vite.config.ts"), root: REPO_ROOT, logLevel: "warn", mode: "production",
    resolve: { alias: [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }] },
    esbuild: { keepNames: true },
    build: { outDir, emptyOutDir: true, target: "esnext", reportCompressedSize: false, chunkSizeWarningLimit: 100_000, rollupOptions: { output: { entryFileNames: "[name].js" } } },
    plugins: [{
      name: "board-panels-bench-entry",
      config(config) {
        config.build!.rollupOptions!.input = { bench: join(REPO_ROOT, "scripts/testing/board-panels-bench-page.tsx") };
      },
    }, {
      name: "board-panels-bench-revision",
      enforce: "pre",
      load(id) {
        const path = relative(REPO_ROOT, id.split("?")[0]!);
        if (!revision || !path.startsWith(OVERLAY_DIR) || path.startsWith(`${OVERLAY_DIR}testing/`)) return null;
        return execFileSync("git", ["show", `${revision}:${path}`], { cwd: REPO_ROOT, encoding: "utf8" });
      },
    }],
  });
  const styles = readdirSync(join(outDir, "assets")).filter((name) => name.endsWith(".css")).map((name) => `<link rel="stylesheet" href="/assets/${name}">`);
  writeFileSync(join(outDir, "bench.html"), `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Production board panels bench</title>${styles.join("")}</head><body><div id="root"></div><script type="module" src="/bench.js"></script></body></html>`);
}

function serve(dir: string) {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname));
    const file = join(dir, path === "/" ? "bench.html" : path);
    if (!file.startsWith(dir)) {
      response.writeHead(403).end();
      return;
    }
    const stream = createReadStream(file);
    stream.on("open", () => {
      response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
      stream.pipe(response);
    });
    stream.on("error", () => response.writeHead(404).end());
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((done) => server.listen(0, "127.0.0.1", () => done({
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/bench.html`,
    close: () => new Promise((closed) => server.close(() => closed())),
  })));
}

// agent-browser's socket lives under this home, and a socket path holds about 100 bytes: macOS's own temporary folder is too deep.
const home = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "omb-board-panels-bench-"));
mkdirSync(join(home, "tmp"), { recursive: true });
const dist = join(home, "dist");
await buildPage(dist);
process.stdout.write(`built the page on React's profiling build${revision ? `, the overlay as at ${revision}` : ""}\n`);
const page = await serve(dist);
const { binary, chrome } = await ensureUiBrowser();
const env = sessionEnv({ home, session: `board-panels-bench-${process.pid}`, chrome });
const browser = (args: string[], timeoutMs?: number) => agentBrowser(binary, env, args, timeoutMs);
interface Results {
  scale: Record<string, number>;
  firstRender: Record<"team" | "assets" | "episodes", Array<Drawn & { rows: number; commits: number }>>;
  opening: Record<"chat" | "details", Drawn>;
  idleFrames: Record<string, unknown>;
  cameraTicks: Record<string, unknown>;
  cameraTicksBurst: Record<string, unknown>;
  snapshots: Record<string, Drawn[]>;
  boardRedraws: Drawn[];
}

const firstRenders = (results: Results) => (["team", "assets", "episodes"] as const)
  .map((tab) => `${line(`first render, ${tab}`, results.firstRender[tab])}, rows ${results.firstRender[tab][0]?.rows}, commits ${results.firstRender[tab][0]?.commits}`);

try {
  await browser(["set", "viewport", "1440", "900"]);
  /** A fresh page each time; `?warm` first draws what the app has drawn before its board opens. */
  const measure = async (query: string): Promise<Results> => {
    await browser(["open", `${page.url}${query}`], 120_000);
    await browser(["wait", "[data-bench-done]"], 600_000).catch(async (error: unknown) => {
      const said = await Promise.all([browser(["errors"]), browser(["console"])]).catch(() => []);
      throw new Error(`the bench never finished. ${JSON.stringify(said).slice(0, 4000)}`, { cause: error });
    });
    const text = (await browser(["eval", "document.querySelector('[data-bench-done]').textContent"])).result;
    if (typeof text !== "string") throw new Error(`the bench left no numbers: ${JSON.stringify(text)}`);
    return JSON.parse(text) as Results;
  };
  const cold = await measure("");
  const appLike = await measure("?warm");
  writeFileSync(out, JSON.stringify({ cold, appLike }));
  const report = [
    `scale ${JSON.stringify(cold.scale)}`,
    "a fresh page:",
    ...firstRenders(cold),
    line("chat opens", [cold.opening.chat]),
    line("details open", [cold.opening.details]),
    `idle frames ${JSON.stringify(cold.idleFrames)}`,
    `camera ticks ${JSON.stringify(cold.cameraTicks)}`,
    `camera ticks, four a frame ${JSON.stringify(cold.cameraTicksBurst)}`,
    ...Object.entries(cold.snapshots).map(([where, runs]) => line(`snapshot, ${where}`, runs)),
    line("board draws the overlay again", cold.boardRedraws),
    "a page that drew what the app draws before its board opens:",
    ...firstRenders(appLike),
  ];
  process.stdout.write(`${report.join("\n")}\n${out}\n`);
} finally {
  if (!await closeBrowserSession(binary, env)) await browser(["close"], 15_000).catch(() => {});
  await page.close();
  await removeTempDir(home);
}
