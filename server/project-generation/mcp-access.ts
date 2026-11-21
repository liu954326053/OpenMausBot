import type { McpServerSpec } from "../contracts.ts";
import { AppConnections, type AppServerAs } from "../mcp-app-connections.ts";
import { McpHttpError, McpRpcError } from "../mcp-http.ts";
import { withMcpSignIn, type McpOAuthManager } from "../mcp-oauth.ts";
import { sendsCredentials } from "../mcp-probe.ts";
import { isRemoteMcpServer, parseStoredMcpServer, type StoredMcpServer } from "../mcp-registry.ts";
import type { McpKeys } from "../vault/mcp-keys.ts";
import { GenerationRefused, maskedServerText, refused, type GenerationErrorName } from "./failure.ts";

/** The longest one tool call may take: a server may make pictures before it answers. */
export const LONGEST_CALL_MS = 10 * 60_000;

export interface GenerationMcpDeps {
  storedServers(): Record<string, unknown>;
  keys?: Pick<McpKeys, "warm" | "resolve">;
  oauth: McpOAuthManager;
  /** The servers each person connects to with their own account. */
  personMcp(): readonly string[];
  policyRefusal(name: string, server: object): string | undefined;
  /** How a command server is started where bots' turns start it. */
  probeAs(server: { bot?: string }): AppServerAs;
  connections?: AppConnections;
}

/** Whose keys a call is made with: the bot's that asked, or the person's. */
export interface McpCaller {
  botId?: string;
}

/** What the tool answered: its result, with the way to mask the server's words in it, or the error it answered with. */
export type ToolAnswer = { ok: true; result: Record<string, unknown>; mask(text: string): string } | { ok: false; error: string };

export interface GenerationMcp {
  /** The servers a project may choose: on, started here, every bot's, one account for the whole team, and allowed. */
  choosable(): string[];
  /** Why `server` cannot be used for generation; null when it can. */
  unusable(server: string): Unusable | null;
  toolNames(server: string, as: McpCaller, signal: AbortSignal): Promise<Set<string>>;
  call(server: string, tool: string, args: Record<string, unknown>, as: McpCaller, signal: AbortSignal): Promise<ToolAnswer>;
  close(): void;
}

export interface Unusable {
  name: GenerationErrorName;
  params: Record<string, string>;
}

interface Target {
  spec: McpServerSpec;
  signedIn: boolean;
  configured: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const specOf = (server: StoredMcpServer): McpServerSpec => (isRemoteMcpServer(server)
  ? { type: server.type, url: server.url, headers: server.headers }
  : { command: server.command, args: server.args, env: server.env });

const configuredValues = (spec: McpServerSpec): string[] => (isRemoteMcpServer(spec) ? [spec.url, ...Object.values(spec.headers)] : Object.values(spec.env));

/**
 * Calls a configured MCP server's tools as the MCP servers page tests one: its saved keys (`vault:` pointers read as the
 * caller), its sign-in, refreshed once when refused, and a command server started where bots' turns start it.
 */
export function createGenerationMcp(deps: GenerationMcpDeps): GenerationMcp {
  const stored = (name: string): StoredMcpServer | null => {
    const raw = deps.storedServers()[name];
    if (raw === undefined) return null;
    const parsed = parseStoredMcpServer(name, raw);
    return parsed.ok ? parsed.server : null;
  };
  const connections = deps.connections ?? new AppConnections({
    idleMs: LONGEST_CALL_MS + 60_000,
    asBot: (name) => {
      const server = stored(name);
      return deps.probeAs(server && !isRemoteMcpServer(server) ? server : {});
    },
  });

  function unusable(name: string): Unusable | null {
    const server = stored(name);
    const why = (reason: GenerationErrorName, params: Record<string, string> = {}): Unusable => ({ name: reason, params: { server: name, ...params } });
    if (!server) return why("serverGone");
    if (!server.enabled) return why("serverOff");
    if (server.runsOn) return why("serverElsewhere", { computer: server.runsOn.label });
    if (deps.policyRefusal(name, server)) return why("serverNotAllowed");
    if (server.bot) return why("serverOneBots");
    if (deps.personMcp().includes(name)) return why("serverPersonal");
    return null;
  }

  async function target(name: string, as: McpCaller): Promise<Target> {
    const refusal = unusable(name);
    if (refusal) throw refused("server_unusable", refusal.name, refusal.params);
    let server = stored(name)!;
    if (deps.keys) {
      await deps.keys.warm(name, server);
      const keyed = deps.keys.resolve(name, server, as.botId);
      if (!keyed.ok) throw refused("keys", keyed.reason === "kept" ? "keyKept" : keyed.reason === "unread" ? "keyUnread" : "keyRemoved", { server: name });
      server = keyed.server;
    }
    const plain = specOf(server);
    if (!isRemoteMcpServer(plain)) return { spec: plain, signedIn: false, configured: configuredValues(plain) };
    const signedIn = deps.oauth.authState(name, plain.url) === "signed-in";
    const spec = (await withMcpSignIn({ [name]: plain }, deps.oauth))[name];
    if (!spec) throw refused("sign_in", "signIn", { server: name });
    return { spec, signedIn, configured: [...configuredValues(plain), ...configuredValues(spec)] };
  }

  /** Runs `use` against the server, once more after a refused sign-in is refreshed. */
  async function withTarget<T>(name: string, as: McpCaller, signal: AbortSignal, use: (target: Target) => Promise<T>): Promise<T> {
    let current = await target(name, as);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await use(current);
      } catch (error) {
        if (signal.aborted || error instanceof GenerationRefused) throw error;
        const remote = isRemoteMcpServer(current.spec) ? current.spec : null;
        const status = error instanceof McpHttpError && !(error instanceof McpRpcError) ? error.status : undefined;
        if (status === 401 && remote) {
          if (current.signedIn && attempt === 0 && await deps.oauth.tokenRefused(name, remote.url) === "refreshed") {
            current = await target(name, as);
            continue;
          }
          if (!current.signedIn && sendsCredentials(remote)) throw refused("keys", "keyRefused", { server: name });
          if (!current.signedIn) deps.oauth.requireSignIn(name, remote.url);
          throw refused("sign_in", "signIn", { server: name });
        }
        const detail = status ? `it answered HTTP ${status}` : maskedServerText(error instanceof Error ? error.message : String(error), current.configured);
        throw refused("unreachable", "unreachable", { server: name, detail: detail || "no answer" });
      }
    }
  }

  return {
    choosable: () => Object.keys(deps.storedServers()).filter((name) => !unusable(name)).sort((a, b) => a.localeCompare(b)),
    unusable,
    toolNames: (name, as, signal) => withTarget(name, as, signal, async ({ spec }) => {
      const tools = await connections.tools(name, spec, signal, false);
      return new Set(tools.map((tool) => String(tool.name)));
    }),
    call: (name, tool, args, as, signal) => withTarget(name, as, signal, async ({ spec, configured }) => {
      try {
        const result = await connections.request(name, spec, "tools/call", { name: tool, arguments: args }, signal, false);
        return { ok: true, result: isRecord(result) ? result : {}, mask: (text: string) => maskedServerText(text, configured) };
      } catch (error) {
        if (error instanceof McpRpcError) return { ok: false, error: maskedServerText(error.detail, configured) };
        throw error;
      }
    }),
    close: () => connections.closeAll(),
  };
}
