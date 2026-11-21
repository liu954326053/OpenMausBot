import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { request } from "../mcp-server.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";
import { ENABLE_ADVANCED_UI, OPEN_SIDEBAR_TOOLS, UI_TOOLS_DIR } from "./control-omb-ui.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const enabled = process.env.OMB_UI_E2E === "1" || Boolean(binary);
if (!enabled) console.log("skipping team lifecycle UI e2e: set OMB_UI_E2E=1 to install the pinned browser");

(enabled ? it : it.skip)("creates an empty team, moves bots, and manages shared instructions in the renderer", async () => {
  let child: ChildProcess | undefined;
  let preview: MountedPreview | undefined;
  let fixtureHandle: string | undefined;
  let fixtureLog: string | undefined;
  let succeeded = false;
  try {
    let stdout = "", stderr = "";
    let info: { ui: string; url: string; botId: string; logPath: string };
    child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "scripts/control-omb.ts"), "ui", "launch"], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += String(chunk); });
    child.on("error", (error) => { stderr += error.message; });
    await expect.poll(() => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`UI launcher exited: ${stderr}`);
      try { info = JSON.parse(stdout); return Boolean(info.ui); } catch { return false; }
    }, { timeout: binary ? 180_000 : 600_000, interval: 250 }).toBe(true);
    fixtureHandle = info!.ui;
    fixtureLog = info!.logPath;
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<Record<string, any>>;
    await ui("eval", "--js", ENABLE_ADVANCED_UI);
    const target = async (name: string, roles: string[]) => {
      let matches: Array<[string, { name: string; role: string }]> = [];
      await expect.poll(async () => {
        const { refs } = await ui("snapshot");
        matches = Object.entries(refs as Record<string, { name: string; role: string }>).filter(([, element]) => element.name === name && roles.includes(element.role));
        return matches.length;
      }, { timeout: 10_000, message: `one ${roles.join("/")} named ${name}` }).toBe(1);
      return `@${matches[0][0]}`;
    };
    const click = async (name: string) => {
      try { return await ui("click", "--ref", await target(name, ["button", "checkbox", "menuitem"])); }
      catch (error) { throw new Error(`Click ${name}: ${error}\n${(await ui("snapshot")).snapshot}`); }
    };
    const type = async (name: string, text: string) => {
      const ref = await target(name, ["textbox"]);
      await ui("click", "--ref", ref);
      // The browser's type action focuses again and collapses selections.
      // Clear through the native input event first, including on rename.
      await ui("eval", "--js", "(() => { const input = document.activeElement; if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) throw new Error('Expected focused input'); input.select(); return true; })()");
      await ui("press", "--keys", "Backspace");
      return ui("type", "--ref", ref, "--text", text);
    };
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const evaluate = async (source: string) => (await ui("eval", "--js", source)).result;
    const focused = () => evaluate("document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim()");
    const manage = async (name: string) => {
      // Native summary nodes have no refs in the pinned browser snapshot.
      const selector = `[data-team-key=${JSON.stringify(name)}] summary`;
      await expect.poll(async () => (await ui("eval", "--js", `Boolean(document.querySelector(${JSON.stringify(selector)}))`)).result,
        { timeout: 10_000 }).toBe(true);
      await ui("eval", "--js", `(() => { const summary = document.querySelector(${JSON.stringify(selector)}); if (!summary.parentElement.open) summary.click(); return summary.parentElement.open; })()`);
    };
    const api = (path: string, method = "GET", body?: unknown) => request(path, { method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, info.url);
    const control = (...args: string[]) => runControlOmb([...args, "--url", info.url]);
    const a = (await control("new-bot", "--name", "Researcher", "--section", "Research") as any).bot;
    const b = (await control("new-bot", "--name", "Engineer", "--section", "Engineering") as any).bot;

    await click("New");
    await click("Add department");
    await type("Department name", "Delivery");
    await click("Create department");
    // Departments are managed on the team map: a new one is shown there.
    await expect.poll(() => evaluate(`Boolean(document.querySelector('[data-team-key="Delivery"]'))`), { timeout: 10_000 }).toBe(true);
    expect((await api("/api/bots?messages=0")).sections).toContain("Delivery");
    await manage("Delivery");
    await click("Move bots to Delivery");
    await click("Researcher");
    await click("Engineer");
    await click("Save");
    await expect.poll(async () => (await api("/api/bots?messages=0")).bots.filter((bot: any) => bot.section === "Delivery").length).toBe(2);
    await manage("Delivery");
    await click("Move bots to Delivery");
    await click("Researcher");
    // Hold only the creation response: persistence and SSE remain real, and
    // the unsaved ticks above must survive the wait.
    await ui("eval", "--js", `(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        if (String(input) !== '/api/bots' || init?.method !== 'POST') return original(input, init);
        const response = await original(input, init);
        window.createdTeamMember = (await response.clone().json()).bot;
        await new Promise(resolve => { window.releaseTeamMember = resolve; });
        window.fetch = original;
        return response;
      };
      return true;
    })()`);
    await click("New bot");
    let created: { id: string; name: string };
    await expect.poll(async () => {
      created = (await ui("eval", "--js", "window.createdTeamMember ?? null")).result;
      return Boolean(created?.id);
    }, { timeout: 10_000 }).toBe(true);
    await ui("eval", "--js", "window.releaseTeamMember(); true");
    const checked = async (name: string) => (await ui("eval", "--js",
      `document.querySelector(${JSON.stringify(`[role="checkbox"][aria-label=${JSON.stringify(name)}]`)})?.getAttribute('aria-checked')`)).result;
    await expect.poll(() => checked(created!.name), { timeout: 10_000 }).toBe("true");
    expect(await checked("Researcher")).toBe("false");
    await click("Save");
    await expect.poll(async () => (await api("/api/bots?messages=0")).bots.find((bot: any) => bot.id === a.id)?.section).toBeUndefined();
    expect((await api("/api/bots?messages=0")).bots.find((bot: any) => bot.id === created!.id)?.section).toBe("Delivery");
    await manage("Delivery");
    await click("Edit Delivery shared instructions");
    await type("Delivery shared instructions", "Research first, then build and review.");
    await click("Save shared instructions");
    expect((await api("/api/section-context?section=Delivery")).text).toBe("Research first, then build and review.");

    await ui("eval", "--js", "location.reload(); true");
    await expect.poll(() => evaluate("Boolean(document.querySelector('[data-tour=tools]'))"), { timeout: 15_000 }).toBe(true);
    await ui("eval", "--js", OPEN_SIDEBAR_TOOLS);
    await click("Team map");
    await manage("Delivery");
    expect(await snapshot()).toContain("Edit Delivery shared instructions");
    // A second fixture client moves the bots out. SSE must keep the empty
    // team visible and make rename/delete available without a reload.
    await api("/api/sidebar-sections", "POST", { name: "", botIds: [a.id, b.id, created!.id] });
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Rename Delivery department");
    await click("Rename Delivery department");
    await type("Department name", "Launch");
    await click("Save name");
    await manage("Launch");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Edit Launch shared instructions");
    expect((await api("/api/section-context?section=Launch")).text).toBe("Research first, then build and review.");
    const screenshot = join(ROOT, ".omb-scratch", "verify-evidence", "team-lifecycle.png");
    await ui("screenshot", "--out", screenshot);
    await manage("Launch");
    await click("Delete Launch department");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('alertdialog "Delete Launch department?"');
    await ui("eval", "--js", `(() => {
      const original = window.fetch.bind(window); window.teamDeleteRequests = 0;
      window.fetch = async (url, init) => {
        if (String(url) === '/api/sidebar-sections?section=Launch' && init?.method === 'DELETE') {
          window.teamDeleteRequests++; await new Promise(resolve => { window.releaseTeamDelete = resolve; });
          if (window.teamDeleteRequests === 1) return new Response(JSON.stringify({ error: "Fixture deletion failure" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        return original(url, init);
      };
      const button = [...document.querySelectorAll('[role="alertdialog"] button')].find(node => node.textContent === 'Delete department');
      button.click(); button.click(); return true;
    })()`);
    await expect.poll(async () => (await ui("eval", "--js", "document.querySelector('[role=alertdialog]')?.getAttribute('aria-busy')")).result).toBe("true");
    expect((await ui("eval", "--js", "window.teamDeleteRequests")).result).toBe(1);
    expect((await ui("eval", "--js", "document.activeElement.getAttribute('role')")).result).toBe("alertdialog");
    expect((await ui("eval", "--js", "[...document.querySelectorAll('[role=alertdialog] button')].every(button => button.disabled)")).result).toBe(true);
    await ui("press", "--keys", "Escape");
    expect(await snapshot()).toContain('alertdialog "Delete Launch department?"');
    await ui("press", "--keys", "Tab");
    expect((await ui("eval", "--js", "document.activeElement.getAttribute('role')")).result).toBe("alertdialog");
    await ui("eval", "--js", "window.releaseTeamDelete(); true");
    await expect.poll(async () => (await ui("eval", "--js", "document.activeElement.textContent")).result).toBe("Cancel");
    await ui("press", "--keys", "Shift+Tab");
    expect((await ui("eval", "--js", "document.activeElement.textContent")).result).toBe("Delete department");
    await click("Delete department");
    await expect.poll(async () => (await ui("eval", "--js", "window.teamDeleteRequests")).result).toBe(2);
    await ui("eval", "--js", "window.releaseTeamDelete(); true");
    await expect.poll(async () => (await api("/api/bots?messages=0")).sections.includes("Launch")).toBe(false);
    // The server commits before the pending DELETE response reaches React.
    // Finish this UI action before the next fixture client creates a section;
    // otherwise its SSE update can race the previous response's section list.
    await expect.poll(snapshot).not.toContain('alertdialog "Delete Launch department?"');

    // Cancel and Escape leave a department and its brief intact, and give focus back to its menu.
    await api("/api/sidebar-sections", "POST", { name: "Empty desk" });
    await api("/api/section-context?section=Empty%20desk", "PUT", { text: "Keep this until deletion is confirmed." });
    const askToDelete = async (name: string) => {
      await manage(name);
      await click(`Delete ${name} department`);
      await expect.poll(snapshot).toContain(`alertdialog "Delete ${name} department?"`);
      expect(await focused()).toBe("Cancel");
    };
    await askToDelete("Empty desk");
    await ui("press", "--keys", "Shift+Tab");
    expect(await focused()).toBe("Delete department");
    await ui("press", "--keys", "Tab");
    expect(await focused()).toBe("Cancel");
    await ui("press", "--keys", "Escape");
    await expect.poll(focused).toBe("Manage Empty desk department");
    expect((await api("/api/sidebar-sections")).sections).toContain("Empty desk");
    expect((await api("/api/section-context?section=Empty%20desk")).text).toBe("Keep this until deletion is confirmed.");
    await askToDelete("Empty desk");
    await click("Cancel");
    await expect.poll(focused).toBe("Manage Empty desk department");
    expect((await api("/api/sidebar-sections")).sections).toContain("Empty desk");
    await askToDelete("Empty desk");
    await click("Delete department");
    await expect.poll(async () => (await api("/api/sidebar-sections")).sections.includes("Empty desk")).toBe(false);
    await expect.poll(() => evaluate(`Boolean(document.querySelector('[data-team-key="Empty desk"]'))`)).toBe(false);
    expect((await fetch(`${info.url}/api/section-context?section=Empty%20desk`)).status).toBe(404);

    // Deleting a department keeps its members: active, pinned and archived
    // bots move to General with their chats intact.
    await control("send", "--bot", a.id, "--text", "Keep this conversation when its department is deleted.");
    expect(await control("wait", "--bot", a.id, "--timeout", "30")).toMatchObject({ status: "settled" });
    const transcript = (await control("messages", "--bot", a.id, "--limit", "10") as any).messages;
    expect(transcript.length).toBeGreaterThan(0);
    const deleteDepartment = async (name: string) => {
      await askToDelete(name);
      expect(await evaluate("document.querySelector('[role=alertdialog]')?.textContent")).toContain(
        "Bots and group chats move to General with their conversations intact.",
      );
      await click("Delete department");
      await expect.poll(async () => (await api("/api/sidebar-sections")).sections.includes(name)).toBe(false);
      await expect.poll(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(`[data-team-key="${name}"]`)}))`)).toBe(false);
    };
    for (const member of [
      { name: "Populated desk", pinned: false, hidden: false },
      { name: "Pinned desk", pinned: true, hidden: false },
      { name: "Archived desk", pinned: false, hidden: true },
    ]) {
      await api(`/api/bots/${a.id}`, "PATCH", { hidden: false, pinned: false });
      await api("/api/sidebar-sections", "POST", { name: member.name, botIds: [a.id] });
      await api(`/api/bots/${a.id}`, "PATCH", { pinned: member.pinned, hidden: member.hidden });
      const card = `[data-team-key="${member.name}"] [data-bot-id="${a.id}"]`;
      await expect.poll(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), { message: "an archived bot is not on the team map" }).toBe(!member.hidden);
      await deleteDepartment(member.name);
      const survivor = (await api("/api/bots?messages=0")).bots.find((bot: any) => bot.id === a.id);
      expect(survivor).toMatchObject({ id: a.id, name: a.name, pinned: member.pinned, hidden: member.hidden });
      expect(survivor.section).toBeUndefined();
      expect((await control("messages", "--bot", a.id, "--limit", "10") as any).messages).toEqual(transcript);
    }
    await api(`/api/bots/${a.id}`, "PATCH", { hidden: false });
    const group = (await api("/api/groups", "POST", { name: "Desk room", memberIds: [a.id, b.id], section: "Room desk" })).group;
    await api(`/api/groups/${group.id}/setup`, "PATCH", { action: "complete", bulletin: "", defaultResponder: { kind: "member", botId: a.id } });
    await control("send-channel", "--channel", group.id, "--text", "Keep this group conversation when its section is deleted.");
    expect(await control("wait", "--channel", group.id, "--timeout", "30")).toMatchObject({ status: "settled" });
    const roomTranscript = (await control("messages", "--channel", group.id, "--limit", "10") as any).messages;
    expect(roomTranscript.length).toBeGreaterThan(0);
    await expect.poll(() => evaluate(`Boolean(document.querySelector('[data-team-key="Room desk"]'))`), { message: "a department holding only a room" }).toBe(true);
    expect((await api("/api/bots?messages=0")).bots.some((bot: any) => bot.section === "Room desk")).toBe(false);
    await deleteDepartment("Room desk");
    const survivingState = await api("/api/bots?messages=0");
    expect(survivingState.bots.map((bot: any) => bot.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const survivingRoom = survivingState.groups.find((room: any) => room.id === group.id);
    expect(survivingRoom).toMatchObject({ id: group.id, name: group.name, memberIds: [a.id, b.id], threadId: group.threadId });
    expect(survivingRoom.section).toBeUndefined();
    expect((await control("messages", "--channel", group.id, "--limit", "10") as any).messages).toEqual(roomTranscript);
    const consoleResult = await ui("console");
    expect(JSON.stringify(consoleResult)).not.toMatch(/Uncaught|ReferenceError/);
    console.info(JSON.stringify({ fixture: info!, screenshot, emptyTeam: true, multiBotMove: true, delayedMemberCreation: true, reload: true, renameAndDelete: true,
      mapDelete: true, mapCancelAndFocus: true, preservedSectionMembers: ["active", "pinned", "archived", "group"],
      preservedBotMessages: transcript.length, preservedGroupMessages: roomTranscript.length }));
    preview = await mountPreview({ info: { url: info!.url } }, {
      entry: "/scripts/testing/confirm-dialog-preview.tsx", route: "/__confirm-focus.html", title: "Confirmation focus regression", logLevel: "silent",
    });
    await ui("eval", "--js", `location.href = ${JSON.stringify(preview.previewUrl)}; true`);
    for (const action of ["Cancel", "Escape", "Confirm"]) {
      await click("Open confirmation");
      await expect.poll(async () => (await ui("eval", "--js", "document.activeElement.textContent")).result).toBe("Cancel");
      if (action === "Escape") await ui("press", "--keys", "Escape");
      else await click(action);
      await expect.poll(async () => (await ui("eval", "--js", "document.activeElement.textContent")).result).toBe("Open confirmation");
    }
    succeeded = true;
  } finally {
    if (!succeeded && fixtureHandle && fixtureLog) {
      try {
        const result = await runControlOmb(["ui", "snapshot", "--ui", fixtureHandle]);
        writeFileSync(`${fixtureLog}.team-lifecycle-failure.json`, JSON.stringify(result, null, 2));
        await runControlOmb(["ui", "screenshot", "--ui", fixtureHandle, "--out", `${fixtureLog}.team-lifecycle-failure.png`]);
        console.info(JSON.stringify({ failureEvidence: `${fixtureLog}.team-lifecycle-failure.json` }));
      } catch { /* The original failure remains authoritative if the browser stopped. */ }
    }
    await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
    await preview?.close();
  }
}, binary ? 420_000 : 840_000);
