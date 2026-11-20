import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CreateTeamProjectResult } from "../shared/team-projects.ts";
import type { TemplateLibraryWire } from "../shared/template-library.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createBotMessageRoutes, type BotMessageRouteDeps } from "./routes/bot-messages.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { Store } from "./store.ts";
import { TeamProjectProposalService } from "./team-project-proposal.ts";

const sonnet: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const servers: Server[] = [];

const LIBRARY: TemplateLibraryWire = {
  bots: [],
  teams: [{
    id: "drama", name: "Short drama team", version: 1, updatedAt: 1, genre: "Romance and revenge", lead: "writer",
    roles: [{ key: "writer", name: "Head writer", title: "Writes the script" }, { key: "editor", name: "Editor", title: "Cuts the episodes" }],
  }],
};

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function fixture() {
  const store = new Store(() => sonnet);
  const main = store.createBot({ name: "MagicBot" });
  const other = store.createBot({ name: "Clive" });
  const lead = store.createBot({ name: "Head writer" });
  const create = vi.fn(async (): Promise<CreateTeamProjectResult> => ({
    project: {
      id: "p1", name: "Palace", folder: "/projects/Palace", section: "Palace", template: { id: "drama", name: "Short drama team", version: 1 },
      leadBotId: lead.id, createdAt: 1, folderState: "ready", botIds: [lead.id],
    },
    missingSkills: [],
  }));
  const answer = vi.fn(() => true);
  const handOff = vi.fn(async (_from: unknown, call: { botIds: string[] }) => ({ status: 200, body: { receipts: [{ botId: call.botIds[0], outcome: "queued", detail: "queued" }] } }));
  const cards = new TeamProjectProposalService({
    store, backends: { templates: { list: () => LIBRARY }, projects: { create }, projectsRoot: () => "/projects" },
    botName: (id) => store.bot(id)?.name, answer, follow: () => {}, release: () => {}, held: () => null, decide: () => {}, handOff,
  });
  const { requestId } = cards.propose({ botId: main.id, threadId: main.threadId, name: "Palace", templateId: "drama", brief: "A revenge drama in twelve episodes." });
  const deps = {
    store, routines: () => null, desktopManaged: false, activeGroupTurnForBot: () => null,
    requestBehavior: (value: unknown) => (value === "allow" || value === "deny" || value === "answer" ? value : null),
    answeredIn: (threadId: string) => threadId,
    cardAnswerRefusal: () => null,
    requestedTaskBot: (botId: string) => store.bot(botId),
    botForThread: (botId: string, threadId: string) => store.projectBotForTask(botId, threadId) ?? store.bot(botId),
    commandRememberRefusal: () => null,
    answeringCardAs: async (_auth: RequestAuth, _threadId: string, _requestId: string, work: () => Promise<unknown>) => { await work(); },
    resolveAndSendTrust: () => false,
    resolveTeamProjectProposal: (args: { threadId: string; requestId: string; behavior: string }, ownerReview: boolean) => cards.respond(args, ownerReview),
  } as unknown as BotMessageRouteDeps;
  const routes = [createBotMessageRoutes(deps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const press = async (path: string, behavior: "allow" | "deny") => {
    const response = await fetch(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ requestId, behavior }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const card = () => store.messagesFor(main.threadId).find((line) => line.card?.requestId === requestId)?.card;
  return { store, main, other, lead, create, answer, handOff, press, card };
}

it("refuses Create from a local browser while a bot is busy, and makes the project once every bot is idle", async () => {
  const { store, main, other, lead, create, answer, handOff, press, card } = await fixture();
  const path = `/api/threads/${main.threadId}/respond`;

  store.setTaskActivity(other.id, other.threadId, "working");
  const refused = await press(path, "allow");
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({ errorKey: "serverError.teamProjectProposal.ownerCreates" });
  expect(String(refused.body.error)).toContain("wait until every bot is idle");
  expect(create).not.toHaveBeenCalled();
  expect(card()?.answered).toBeUndefined();

  store.setTaskActivity(other.id, other.threadId, "idle");
  expect(await press(path, "allow")).toMatchObject({ status: 200, body: { ok: true, outcome: "allowed-once", result: { state: "created", projectId: "p1", leadBotId: lead.id } } });
  expect(create).toHaveBeenCalledExactlyOnceWith({ name: "Palace", templateId: "drama" });
  expect(card()).toMatchObject({ answered: "allow", teamProjectProposal: { result: { state: "created", leadName: "Head writer" } } });
  expect(handOff).toHaveBeenCalledOnce();
  expect(answer).not.toHaveBeenCalled();
});

it("takes Cancel from anyone who can answer the chat's cards, a busy bot or not", async () => {
  const { store, main, other, create, press, card } = await fixture();
  store.setTaskActivity(other.id, other.threadId, "working");

  expect(await press(`/api/threads/${main.threadId}/respond`, "deny")).toMatchObject({ status: 200, body: { ok: true, outcome: "rejected", result: { state: "cancelled" } } });
  expect(create).not.toHaveBeenCalled();
  expect(card()).toMatchObject({ answered: "deny", teamProjectProposal: { result: { state: "cancelled" } } });
});

it("answers the card through the bot's own respond route as well", async () => {
  const { main, create, press } = await fixture();

  expect(await press(`/api/bots/${main.id}/respond`, "allow")).toMatchObject({ status: 200, body: { ok: true, result: { state: "created" } } });
  expect(create).toHaveBeenCalledOnce();
});
