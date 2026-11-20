import { describe, expect, it } from "vitest";

import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { resolveTeammate, unreachableTeammate, type RosterMember } from "../peer-roster.ts";
import { createPersonalReach } from "./personal-reach.ts";

const MIRA = "mira@acme.test";
const key = (email: string) => `p_${email.replace(/\W/g, "").padEnd(22, "x").slice(0, 22)}`;
const mausbot: RosterMember = { id: "maus", name: "MagicBot", defaultBot: { person: MIRA }, visibility: { people: [MIRA] } };
const bensMausbot: RosterMember = { id: "ben-maus", name: "MagicBot", defaultBot: { person: "ben@acme.test" }, visibility: { people: ["ben@acme.test"] } };
const sales: RosterMember = { id: "sales", name: "Sales" };
const archive: RosterMember = { id: "archive", name: "Archive" };
const payroll: RosterMember = { id: "payroll", name: "Payroll", visibility: { people: ["ben@acme.test"] } };
const gone: RosterMember = { id: "gone", name: "Gone", hidden: true };
const bots = [mausbot, bensMausbot, sales, archive, payroll, gone];
const levels: Record<string, BotAccessLevel> = { sales: "chat", archive: "view", payroll: "none", gone: "chat", "ben-maus": "edit" };
const privateTo: Record<string, string | null> = { mine: key(MIRA), bens: key("ben@acme.test"), shared: null };

function world(acting: string | null = key(MIRA), behind = true) {
  return createPersonalReach({
    privateTo: (threadId) => privateTo[threadId] ?? null,
    personKey: key,
    level: (bot) => levels[bot.id] ?? "none",
    personBehind: () => behind,
    actingFor: () => acting,
  });
}

describe("a person's own MagicBot reaching the team's bots", () => {
  it("reaches only the bots its person may chat with, from a chat private to them", () => {
    expect(world().peers(bots, mausbot, "mine").map((bot) => bot.id)).toEqual(["sales"]);
    expect(world().reaches(mausbot, sales, "shared")).toBe(false);
    expect(world().reaches(mausbot, sales, "bens")).toBe(false);
    expect(world().reaches(sales, archive, "mine"), "any other bot keeps the audience rule").toBe(false);
  });

  it("lists nothing, and hands nothing on, when its person's own request is not behind the turn", () => {
    expect(world(key(MIRA), false).peers(bots, mausbot, "mine")).toEqual([]);
    expect(world(null).handOnProblem(mausbot, sales, "mine", "turn")).toMatch(/routine, an event or a line another app passed on/);
    expect(world().handOnProblem(mausbot, sales, "mine", "turn")).toBeUndefined();
  });

  it("never names a bot its person cannot see, nor another person's MagicBot", () => {
    for (const hidden of [payroll, bensMausbot]) {
      expect(world().hides(mausbot, hidden)).toBe(true);
      expect(world().refusal(mausbot, hidden, "mine")).toBe(`No bot with id "${hidden.id}" — call list_bots and copy the exact id from the result`);
      expect(unreachableTeammate(bots, mausbot, hidden.name, (bot) => world().hides(mausbot, bot))?.id).not.toBe(hidden.id);
    }
    const wider = (reach = world()) => ({ reaches: (bot: RosterMember) => reach.listed(mausbot, bot, "mine"), hides: (bot: RosterMember) => reach.hides(mausbot, bot), refusal: (bot: RosterMember) => reach.refusal(mausbot, bot, "mine") });
    const unknown = resolveTeammate(bots, mausbot, "Nobody", undefined, undefined, wider());
    expect(resolveTeammate(bots, mausbot, "Payroll", undefined, undefined, wider())).toEqual({ error: (unknown as { error: string }).error.replaceAll("Nobody", "Payroll") });
    expect(resolveTeammate(bots, mausbot, "payroll", undefined, undefined, wider())).not.toEqual({ id: "payroll", byName: false });
    // "Sales" is this bot's id in another case, which names it as its id would (byName false).
    expect(resolveTeammate(bots, mausbot, "Sales", undefined, undefined, wider())).toEqual({ id: "sales", byName: false });
    expect(resolveTeammate(bots, mausbot, "@sales", undefined, undefined, wider())).toEqual({ id: "sales", byName: true });
  });

  it("refuses a bot its person can only view, and says so", () => {
    expect(world().reaches(mausbot, archive, "mine")).toBe(false);
    expect(world().refusal(mausbot, archive, "mine")).toMatch(/view only/);
  });

  it("carries placed work only in a thread private to the same person, traced to their request", () => {
    const placed = (threadId: string, kind: "user" | "outside" = "user") => ({ id: "as_1", threadId, origin: kind === "user" ? { kind, request: "pull Q3" } as const : { kind } as const });
    expect(world().carries(mausbot, sales, "mine", placed("mine"))).toBe(true);
    expect(world().carries(mausbot, sales, "mine", placed("shared"))).toBe(false);
    expect(world().carries(mausbot, sales, "mine", placed("bens"))).toBe(false);
    expect(world().carries(mausbot, sales, "mine", placed("mine", "outside"))).toBe(false);
  });

  it("hands on only in its person's own name, and leaves every other hand-off to the usual rules", () => {
    expect(() => world().checkHandOn(mausbot, sales, "mine", key(MIRA))).not.toThrow();
    expect(() => world().checkHandOn(mausbot, sales, "mine", key(MIRA), { threadId: "mine" })).not.toThrow();
    expect(() => world().checkHandOn(mausbot, sales, "mine", key("ben@acme.test"))).toThrow(/person's own chats/);
    expect(() => world().checkHandOn(mausbot, sales, "mine", key(MIRA), { threadId: "bens" })).toThrow(/person's own chats/);
    expect(() => world().checkHandOn(mausbot, sales, "mine", key(MIRA), {})).toThrow(/person's own chats/);
    expect(() => world().checkHandOn(mausbot, archive, "mine", key("ben@acme.test"))).not.toThrow();
    expect(() => world().checkHandOn(sales, archive, "mine", key("ben@acme.test"))).not.toThrow();
  });

  it("stops at a team project's wall: of a project's bots it reaches the lead alone, and never names a member", () => {
    const lead: RosterMember = { id: "lead", name: "Showrunner", chiefOfStaff: true, teamProject: { id: "drama" } };
    const writer: RosterMember = { id: "writer", name: "Writer", teamProject: { id: "drama" } };
    const reach = createPersonalReach({
      privateTo: (threadId) => privateTo[threadId] ?? null, personKey: key, level: () => "chat", personBehind: () => true, actingFor: () => key(MIRA),
    });
    const team = [mausbot, sales, lead, writer];
    expect(reach.peers(team, mausbot, "mine").map((bot) => bot.id).sort()).toEqual(["lead", "sales"]);
    expect(reach.reaches(mausbot, lead, "mine")).toBe(true);
    expect(reach.reaches(mausbot, writer, "mine")).toBe(false);
    expect(reach.listed(mausbot, writer, "mine")).toBe(false);
    expect(reach.carries(mausbot, writer, "mine", { id: "as_1", threadId: "mine", origin: { kind: "user", request: "x" } })).toBe(false);
    expect(reach.refusal(mausbot, writer, "mine"), "the usual refusal says the id is unknown").toBeNull();
    expect(reach.handOnProblem(mausbot, writer, "mine", "turn")).toBeUndefined();
    const wider = { reaches: (bot: RosterMember) => reach.listed(mausbot, bot, "mine"), hides: (bot: RosterMember) => reach.hides(mausbot, bot), refusal: (bot: RosterMember) => reach.refusal(mausbot, bot, "mine") };
    const refused = resolveTeammate(team, mausbot, "writer", undefined, undefined, wider);
    expect(refused).toMatchObject({ error: expect.stringContaining('No bot with id or name "writer"') });
    expect(resolveTeammate(team, mausbot, "lead", undefined, undefined, wider)).toEqual({ id: "lead", byName: false });
    const inProject: RosterMember = { ...mausbot, id: "inside", teamProject: { id: "drama" } };
    expect(reach.reaches(inProject, sales, "mine"), "a default bot inside a project is no main bot").toBe(false);
  });

  it("answers a waiting question only in its person's own chats", () => {
    expect(world().mayAnswerIn("mine", "mine")).toBe(true);
    expect(world().mayAnswerIn("mine", "bens")).toBe(false);
    expect(world().mayAnswerIn("shared", "shared")).toBe(false);
  });
});
