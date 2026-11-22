// A team's pipeline on the team map in the real renderer, on a disposable fake-engine server, in Chinese: the main
// bot's model judges a new drama team and the map draws its stages and lines; a line drawn from a card's dot menu
// marks both ends as set by hand, one that would close a loop is refused in the server's words, and a selected line
// is taken away; judging again shows the members being placed until the answer comes, Undo puts the team back as it
// was, and a judgement that fails leaves the members under the lead. Nothing here reaches the user's data or port 8799.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { TeamPipelineWire } from "../../shared/team-pipeline.ts";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { ENABLE_ADVANCED_UI, OPEN_TEAM_MAP, UI_TOOLS_DIR } from "./control-omb-ui.ts";
import { fixtureApi } from "./preview-fixture.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const enabled = process.env.OMB_UI_E2E === "1" || Boolean(binary);
if (!enabled) console.info("skipping the team pipeline map UI e2e: set OMB_UI_E2E=1 to install the pinned browser");
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR;

const TEAM = "漫剧工作室";

type Bot = { id: string; name: string };

(enabled ? it : it.skip)("judges a drama team, draws its pipeline, and changes, judges again and puts back its lines on the map", async () => {
  let child: ChildProcess | undefined;
  const scratch = mkdtempSync(join(tmpdir(), "omb-pipeline-map-"));
  const judgeFile = join(scratch, "judge.txt");
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  const evidence: Record<string, unknown> = {};
  try {
    let stdout = "", stderr = "";
    let info: { ui: string; url: string } | undefined;
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts/control-omb.ts"), "ui", "launch"], {
      cwd: ROOT, env: { ...process.env, FAKE_CLAUDE_JUDGE_FILE: judgeFile, OMB_DEFAULT_LANGUAGE: "zh" }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += String(chunk); });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`UI launcher exited: ${stderr}`);
      try { info = JSON.parse(stdout); return Boolean(info?.ui); } catch { return false; }
    }, { timeout: binary ? 180_000 : 600_000, interval: 250 }).toBe(true);
    const fixture = info!;
    const api = fixtureApi(fixture.url);
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<Record<string, any>>;
    const evaluate = async <T = unknown>(js: string) => (await ui("eval", "--js", js)).result as T;
    const shot = async (name: string) => { if (evidenceDir) await ui("screenshot", "--out", join(evidenceDir, name)); };
    const waitFor = (js: string, message: string, timeout = 15_000) =>
      expect.poll(() => evaluate<boolean>(`Boolean(${js})`), { timeout, interval: 150, message }).toBe(true);
    const click = (selector: string) => evaluate(`(() => { const found = document.querySelector(${JSON.stringify(selector)}); found?.click(); return Boolean(found); })()`);

    await api("PUT", "/api/config", { language: "zh" });
    const member = async (name: string, title: string) => (await api("POST", "/api/bots", { name, title, section: TEAM })).bot as Bot;
    const lead = await member("云舟", "制片人");
    const writer = await member("砚青", "编剧");
    const artist = await member("墨白", "分镜与美术设计");
    const editor = await member("青禾", "后期合成");
    const order = ((await api("GET", "/api/bots?messages=0")).bots as Bot[]).map((bot) => bot.id).filter((id) => [lead, writer, artist, editor].some((bot) => bot.id === id));
    /** The judge's prompt names each member by its place in the team's order, as the app lists the bots. */
    const key = (bot: Bot) => `m${order.indexOf(bot.id) + 1}`;
    writeFileSync(judgeFile, JSON.stringify({ [key(writer)]: ["script"], [key(artist)]: ["character", "storyboard"], [key(editor)]: ["post"] }));
    await api("PATCH", `/api/bots/${lead.id}`, { chiefOfStaff: true });
    const team = async () => ((await api("GET", "/api/team-pipelines")).teams as TeamPipelineWire[]).find((one) => one.chiefId === lead.id);
    const judged = { [lead.id]: ["lead"], [writer.id]: ["script"], [artist.id]: ["character", "storyboard"], [editor.id]: ["post"] };
    await expect.poll(async () => { const now = await team(); return now && !now.pending.length ? now.stages : null; }, { timeout: 30_000, message: "the team is judged" }).toEqual(judged);

    await evaluate(ENABLE_ADVANCED_UI);
    await evaluate(`(() => { localStorage.setItem("omb-language", "zh"); location.reload(); return true; })()`);
    await expect.poll(() => evaluate<boolean>(OPEN_TEAM_MAP), { timeout: 30_000, interval: 500, message: "the team map opens" }).toBe(true);
    await waitFor("document.querySelector('[data-team-pipeline] [data-pipeline-card]')", "the team draws its pipeline", 30_000);

    const pipelineOnMap = `document.querySelector('[data-team-pipeline]')`;
    const notes = () => evaluate<Record<string, string>>(`Object.fromEntries([...${pipelineOnMap}.querySelectorAll('[data-pipeline-card]')].map((card) => [card.dataset.pipelineCard, card.querySelector('[data-pipeline-note]')?.textContent.trim() ?? ""]))`);
    const lines = () => evaluate<string[]>(`[...${pipelineOnMap}.querySelectorAll('[data-pipeline-line]')].map((line) => line.dataset.pipelineLine).sort()`);
    const columns = () => evaluate<Record<string, string>>(`Object.fromEntries([...${pipelineOnMap}.querySelectorAll('[data-pipeline-card]')].map((card) => [card.dataset.pipelineCard, card.dataset.column]))`);
    const lefts = () => evaluate<Record<string, number>>(`Object.fromEntries([...${pipelineOnMap}.querySelectorAll('[data-pipeline-card]')].map((card) => [card.dataset.pipelineCard, card.getBoundingClientRect().left]))`);
    const line = (from: Bot, to: Bot) => `${from.id}:${to.id}`;
    const named = (byId: Record<string, string>) => Object.fromEntries([lead, writer, artist, editor].map((bot) => [bot.name, byId[bot.id] ?? null]));
    const drama = [line(lead, writer), line(writer, artist), line(artist, editor)].sort();

    expect(named(await notes())).toEqual({ 云舟: "负责人", 砚青: "编剧", 墨白: "角色设计 · 分镜", 青禾: "后期" });
    expect(await lines()).toEqual(drama);
    expect(named(await columns())).toEqual({ 云舟: "lead", 砚青: "script", 墨白: "character", 青禾: "post" });
    const left = await lefts();
    expect(left[lead.id]! < left[writer.id]! && left[writer.id]! < left[artist.id]! && left[artist.id]! < left[editor.id]!).toBe(true);
    evidence.judged = { notes: named(await notes()), columns: named(await columns()) };
    await shot("01-judged-drama-team.png");

    const menuItem = (from: Bot, to: Bot) => `(() => {
      const menu = document.querySelector(${JSON.stringify(`[role=menu][aria-label="${from.name}的产出交给"]`)});
      const item = menu && [...menu.querySelectorAll('[role=menuitemcheckbox]')].find((one) => one.textContent.trim() === ${JSON.stringify(to.name)});
      item?.click();
      return Boolean(item);
    })()`;
    const pickFromDot = async (from: Bot, to: Bot) => {
      await click(`[data-pipeline-dot="${from.id}"]`);
      await waitFor(menuItem(from, to).replace("item?.click();", ""), `${from.name}'s menu lists ${to.name}`);
      expect(await evaluate<boolean>(menuItem(from, to))).toBe(true);
    };

    await pickFromDot(writer, editor);
    await expect.poll(lines, { message: "the line drawn from the menu" }).toEqual([...drama, line(writer, editor)].sort());
    await expect.poll(async () => named(await notes())).toEqual({ 云舟: "负责人", 砚青: "编剧 手动", 墨白: "角色设计 · 分镜", 青禾: "后期 手动" });
    expect((await team())!.manual.sort()).toEqual([writer.id, editor.id].sort());
    await shot("02-line-drawn-by-hand.png");

    await pickFromDot(editor, writer);
    await waitFor(`${pipelineOnMap}.querySelector('[role=alert]')`, "the loop is refused");
    const refusal = await evaluate<string>(`${pipelineOnMap}.querySelector('[role=alert]').textContent.trim()`);
    expect(refusal).toContain("会形成回路");
    expect(await lines()).toEqual([...drama, line(writer, editor)].sort());
    evidence.refusal = refusal;
    await shot("03-loop-refused.png");
    await click(`[data-team-pipeline] [role=alert] button[aria-label="关闭"]`);

    expect(await evaluate<boolean>(`(() => {
      const hit = ${pipelineOnMap}.querySelector(${JSON.stringify(`path[role=button][aria-label="从${writer.name}到${editor.name}的线"]`)});
      hit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return Boolean(hit);
    })()`)).toBe(true);
    await waitFor(`document.querySelector(${JSON.stringify(`button[aria-label="去掉从${writer.name}到${editor.name}的线"]`)})`, "the selected line offers its removal");
    await shot("04-line-selected.png");
    await click(`button[aria-label="去掉从${writer.name}到${editor.name}的线"]`);
    await expect.poll(lines, { message: "the line taken away" }).toEqual(drama);

    const sectionKey = await evaluate<string>(`${pipelineOnMap}.dataset.teamPipeline`);
    const rejudge = async () => {
      expect(await click(`summary[aria-label="管理 ${TEAM} 部门"]`)).toBe(true);
      await waitFor(`document.querySelector(${JSON.stringify(`[data-pipeline-rejudge="${sectionKey}"]`)})`, "the team menu offers judging again");
      expect(await click(`[data-pipeline-rejudge="${sectionKey}"]`)).toBe(true);
    };
    const toastUndo = `[...document.querySelectorAll('[data-access-toast] button')].find((button) => button.textContent.trim() === "撤销")`;
    const pendingOnMap = () => evaluate<number>(`${pipelineOnMap}.querySelectorAll('[data-pipeline-pending]').length`);

    const beforeUndo = await team();
    await rejudge();
    await waitFor(toastUndo, "judging again offers Undo", 3_000);
    expect(await evaluate<boolean>(`(() => { const undo = ${toastUndo}; undo?.click(); return Boolean(undo); })()`)).toBe(true);
    await expect.poll(team, { timeout: 10_000, message: "Undo puts the team back" }).toEqual(beforeUndo);
    await expect.poll(async () => named(await notes()), { timeout: 10_000 }).toEqual({ 云舟: "负责人", 砚青: "编剧 手动", 墨白: "角色设计 · 分镜", 青禾: "后期 手动" });
    expect(await lines()).toEqual(drama);

    await rejudge();
    await expect.poll(pendingOnMap, { timeout: 3_000, message: "the members are being placed" }).toBe(3);
    evidence.judgingAgain = named(await notes());
    await shot("05-judging-again.png");
    const startedAt = Date.now();
    await expect.poll(async () => named(await notes()), { timeout: 8_000, interval: 250, message: "the answer replaces the marks without a reload" })
      .toEqual({ 云舟: "负责人", 砚青: "编剧", 墨白: "角色设计 · 分镜", 青禾: "后期" });
    evidence.placedAfterMs = Date.now() - startedAt;
    expect(await lines()).toEqual(drama);
    expect((await team())!.manual).toEqual([]);
    await shot("06-judged-again.png");

    rmSync(judgeFile);
    await expect.poll(() => evaluate<boolean>(`!document.querySelector('[data-access-toast]')`), { timeout: 10_000 }).toBe(true);
    await rejudge();
    await expect.poll(async () => named(await notes()), { timeout: 8_000, interval: 250, message: "a failed judgement leaves the members under the lead" })
      .toEqual({ 云舟: "负责人", 砚青: "", 墨白: "", 青禾: "" });
    expect(await lines()).toEqual([line(lead, writer), line(lead, artist), line(lead, editor)].sort());
    const failed = (await team())!;
    expect(failed.pending).toEqual([]);
    expect(failed.stages).toEqual({ [lead.id]: ["lead"], [writer.id]: ["other"], [artist.id]: ["other"], [editor.id]: ["other"] });
    evidence.failed = { notes: named(await notes()), stages: failed.stages };
    await shot("07-judgement-failed.png");
  } finally {
    if (evidenceDir) writeFileSync(join(evidenceDir, "team-pipeline-map-ui.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    if (child) await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
    rmSync(scratch, { recursive: true, force: true });
  }
}, 720_000);
