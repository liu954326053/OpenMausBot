import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { chiefLevel, holdsMagicBotTools } from "./chief-level.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { ensureDefaultBot } from "./default-bot.ts";
import { mainChief, proactiveOwner } from "./host/proactive-owner.ts";
import { chiefForBot } from "./incidents.ts";
import { canManage, canReach, inChargeOfEvery, isMainBot, isTeamProjectLead, reachablePeers } from "./peer-roster.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
/** A new department reaches the Chiefs in charge of every department one step after the write that made it. */
const granted = () => new Promise<void>((done) => setImmediate(done));

function installation() {
  const store = new Store(selection);
  store.seedIfEmpty();
  const main = ensureDefaultBot(store, { dataDir: DATA_DIR })!;
  const project = (id: string, department: string) => {
    const lead = store.createBot({ name: `${department} lead`, section: department });
    const member = store.createBot({ name: `${department} writer`, section: department });
    store.patchBot(lead.id, { teamProject: { id, role: "lead" } });
    store.patchBot(member.id, { teamProject: { id, role: "writer" } });
    store.setChiefOfStaff(lead.id);
    return { lead: () => store.bot(lead.id)!, member: () => store.bot(member.id)! };
  };
  return { store, main: () => store.bot(main.id)!, project };
}

describe("every team project has its own lead under the main bot", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("keeps one lead per project department, and making a lead never demotes the main bot or another project's lead", () => {
    const app = installation();
    expect(app.main()).toMatchObject({ chiefOfStaff: true, defaultBot: {} });
    const a = app.project("project-a", "Midnight Train");
    const b = app.project("project-b", "Paper Moon");
    const ids = (bots: readonly { id: string }[]) => bots.map((bot) => bot.id).sort();
    expect(ids(app.store.bots.filter((bot) => bot.chiefOfStaff))).toEqual(ids([app.main(), a.lead(), b.lead()]));
    expect(ids(app.store.bots.filter(isTeamProjectLead))).toEqual(ids([a.lead(), b.lead()]));
    expect(ids(app.store.bots.filter(isMainBot))).toEqual([app.main().id]);

    const second = app.store.createBot({ name: "Second lead", section: "Midnight Train" });
    app.store.patchBot(second.id, { teamProject: { id: "project-a", role: "second" } });
    app.store.setChiefOfStaff(second.id);
    expect(a.lead().chiefOfStaff, "a department has one lead").toBe(false);
    expect(ids(app.store.bots.filter(isTeamProjectLead))).toEqual(ids([app.store.bot(second.id)!, b.lead()]));
    expect(app.main().chiefOfStaff).toBe(true);
  });

  it("leaves the main bot above every lead: its tools, the person's day and problems outside projects stay with it", () => {
    const app = installation();
    const a = app.project("project-a", "Midnight Train");
    const b = app.project("project-b", "Paper Moon");
    const outside = app.store.createBot({ name: "Researcher" });
    expect(holdsMagicBotTools(app.main())).toBe(true);
    expect(chiefLevel(a.lead()) && chiefLevel(b.lead())).toBe(true);
    expect(holdsMagicBotTools(a.lead())).toBe(false);
    expect(mainChief(app.store)?.id).toBe(app.main().id);
    expect(proactiveOwner(app.store)?.id).toBe(app.main().id);
    expect(chiefForBot(app.store.bots, app.store.bot(outside.id)!)?.id).toBe(app.main().id);
    expect(chiefForBot(app.store.bots, a.member())?.id).toBe(a.lead().id);
    expect(chiefForBot(app.store.bots, b.member())?.id).toBe(b.lead().id);
  });

  it("never takes a project's lead for the main Chief, even where no other Chief is left", () => {
    const app = installation();
    const a = app.project("project-a", "Midnight Train");
    app.store.patchBot(app.main().id, { chiefOfStaff: false, hidden: true });
    expect(a.lead().chiefOfStaff).toBe(true);
    expect(mainChief(app.store)).toBeNull();
    expect(proactiveOwner(app.store)).toBeNull();
  });

  it("gives the main bot each project's department by name and, by that, nothing inside the project", async () => {
    const app = installation();
    const a = app.project("project-a", "Midnight Train");
    await granted();
    const main = app.main();
    expect(main.managedSections).toContain("Midnight Train");
    expect(inChargeOfEvery(main, app.store.sections)).toBe(true);
    expect(inChargeOfEvery(a.lead(), app.store.sections)).toBe(false);
    expect(canReach(main, a.lead())).toBe(true);
    expect(canManage(main, a.lead())).toBe(false);
    expect(canReach(main, a.member())).toBe(false);
    expect(canManage(main, a.member())).toBe(false);
    expect(canManage(a.lead(), a.member())).toBe(true);
    expect(canManage(a.lead(), main)).toBe(false);
    expect(reachablePeers(app.store.bots, main).map((bot) => bot.id)).toEqual([a.lead().id]);
    expect(reachablePeers(app.store.bots, a.member()).map((bot) => bot.id).sort()).toEqual([a.lead().id, main.id].sort());
  });
});
