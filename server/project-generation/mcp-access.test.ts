import { afterEach, describe, expect, it } from "vitest";

import type { McpOAuthManager } from "../mcp-oauth.ts";
import { startFakeGenerationMcp } from "../testing/fake-generation-mcp-server.ts";
import { GENERATION_KEY } from "../testing/project-generation-harness.ts";
import { GenerationRefused } from "./failure.ts";
import { createGenerationMcp, type GenerationMcp, type GenerationMcpDeps } from "./mcp-access.ts";

const opened: Array<{ close(): unknown }> = [];
afterEach(async () => {
  for (const each of opened.splice(0)) await each.close();
});

function access(servers: Record<string, unknown>, extra: Partial<GenerationMcpDeps> = {}) {
  const signIns: string[] = [];
  const oauth = {
    authState: () => "none", accessToken: async () => null, tokenRefused: async () => "unknown",
    requireSignIn: (name: string) => signIns.push(name), markNeedsSignIn: () => undefined,
  } as unknown as McpOAuthManager;
  const mcp = createGenerationMcp({ storedServers: () => servers, oauth, personMcp: () => [], policyRefusal: () => undefined, probeAs: () => ({}), ...extra });
  opened.push(mcp);
  return { mcp, signIns };
}

async function fake() {
  const started = await startFakeGenerationMcp({ key: GENERATION_KEY });
  opened.push(started);
  return started;
}

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof GenerationRefused) return error.failure;
    throw error;
  }
  throw new Error("not refused");
}

const names = (mcp: GenerationMcp, server: string) => mcp.toolNames(server, {}, AbortSignal.timeout(5000));

describe("a project's MCP server", () => {
  it("is one that is on, runs here, serves every bot, is one account for the team and is allowed", async () => {
    const url = "https://mcp.example/mcp";
    const { mcp } = access({
      gen: { url }, off: { url, enabled: false }, far: { command: "gen-mcp", runsOn: { environmentId: "vm-1", label: "Studio Mac" } },
      banned: { url }, solo: { url, bot: "bot-a" }, mine: { url },
    }, { policyRefusal: (name) => (name === "banned" ? "blocked" : undefined), personMcp: () => ["mine"] });
    expect(mcp.choosable()).toEqual(["gen"]);
    expect(Object.fromEntries(["gone", "off", "far", "banned", "solo", "mine", "gen"].map((name) => [name, mcp.unusable(name)]))).toEqual({
      gone: { name: "serverGone", params: { server: "gone" } },
      off: { name: "serverOff", params: { server: "off" } },
      far: { name: "serverElsewhere", params: { server: "far", computer: "Studio Mac" } },
      banned: { name: "serverNotAllowed", params: { server: "banned" } },
      solo: { name: "serverOneBots", params: { server: "solo" } },
      mine: { name: "serverPersonal", params: { server: "mine" } },
      gen: null,
    });
    expect(await refusal(() => names(mcp, "solo"))).toMatchObject({ code: "server_unusable", error: "The MCP server solo belongs to one bot. Choose a server all bots share in this project's settings." });
  });

  it("is called with its saved key, and a refused key or a missing sign-in is said as such", async () => {
    const server = await fake();
    const { mcp, signIns } = access({
      gen: { url: server.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } },
      stale: { url: server.url, headers: { Authorization: "Bearer sk-gen-stale-0000000000000000" } },
      bare: { url: server.url },
    });
    expect([...await names(mcp, "gen")].sort()).toEqual(["cancel_task", "generate_image", "generate_video", "list_models", "task_status"]);
    expect(await refusal(() => names(mcp, "stale"))).toMatchObject({ code: "keys", error: "stale refused its key. Check the key in Apps → MCP servers, then try again." });
    expect(await refusal(() => names(mcp, "bare"))).toMatchObject({ code: "sign_in", error: "Sign in to bare in Apps → MCP servers, then try again." });
    expect(signIns).toEqual(["bare"]);
  });

  it("reads Vault keys as the bot that asked", async () => {
    const server = await fake();
    const { mcp } = access({ gen: { url: server.url, headers: { Authorization: "Bearer {{vault:gen}}" } } }, {
      keys: {
        warm: async () => undefined,
        resolve: ((_name: string, stored: { headers: Record<string, string> }, botId?: string) => (botId === "bot-kept"
          ? { ok: false, reason: "kept", why: "kept" }
          : { ok: true, server: { ...stored, headers: { Authorization: `Bearer ${GENERATION_KEY}` } } })) as never,
      },
    });
    expect((await names(mcp, "gen")).has("generate_video")).toBe(true);
    expect(await refusal(() => mcp.toolNames("gen", { botId: "bot-kept" }, AbortSignal.timeout(5000)))).toMatchObject({
      code: "keys", error: "The key gen uses is kept from this bot in the Vault. Let the bot use it in Settings → Vault.",
    });
  });

  it("can't be reached without its address or keys showing in what is said", async () => {
    const { mcp } = access({ gen: { url: "http://127.0.0.1:9/mcp?token=tok-9d8e7f6a5b4c3d2e", headers: { "X-Api-Key": GENERATION_KEY } } });
    const said = await refusal(() => names(mcp, "gen"));
    expect(said.code).toBe("unreachable");
    expect(said.error).toMatch(/^The MCP server gen couldn't be reached \(.+\)\. Check it in Apps → MCP servers, then try again\.$/);
    expect(JSON.stringify(said)).not.toMatch(/tok-9d8e7f6a5b4c3d2e|sk-gen-/);
  });

  it("answers a tool's JSON-RPC error as that tool's error", async () => {
    const server = await fake();
    const { mcp } = access({ gen: { url: server.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` } } });
    expect(await mcp.call("gen", "make_film", {}, {}, AbortSignal.timeout(5000))).toEqual({ ok: false, error: "Unknown tool make_film" });
  });
});
