import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../../shared/runtime-events";
import { claudeElicitations } from "../../server/drivers/claude-elicitation";
import { CodexDriver } from "../../server/drivers/codex";
import { readMessage } from "../../server/message-db";
import { runtimeRequestCardFields } from "../../server/request-card";
import { Store } from "../../server/store";
import { recordEvents } from "../../server/testing/events";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApprovalPanel, pendingApprovals, spokenApprovalPrompt } from "@/components/PendingApproval";
import type { Message } from "@/state/store";
import { approvalDetailText } from "./approval-summary";
import { setLocale } from "./i18n";

vi.mock("../../server/drivers/codex-release", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/drivers/codex-release")>(),
  readLatestCodexRelease: async () => "0.156.1",
}));

type RequestOpened = Extract<RuntimeEvent, { type: "request.opened" }>;
const selection = () => ({ instanceId: "fixture", model: "fixture-model" });

function claudeRequest(server: string, message: string): RequestOpened {
  const events: RequestOpened[] = [];
  const elicitation = claudeElicitations(async () => true, (event) => {
    if (event.type === "request.opened") events.push({
      eventId: randomUUID(), provider: "claude", threadId: randomUUID(), createdAt: new Date().toISOString(), ...event,
    });
  });
  expect(elicitation.frame({
    type: "control_request", request_id: "confirmation",
    request: { subtype: "elicitation", mcp_server_name: server, message, mode: "form", requested_schema: { properties: {} } },
  })).toBe(true);
  expect(events).toHaveLength(1);
  return events[0]!;
}

function persistedRequest(event: RequestOpened): Message {
  const store = new Store(selection);
  const sent = store.appendMessage(event.threadId, {
    role: "bot", kind: "options",
    card: { title: "Approval needed", ...runtimeRequestCardFields(event, { permission: true, guestDriven: false }) },
  });
  const stored = readMessage(event.threadId, sent.id);
  expect(stored?.card?.subtitle).toBe(sent.card?.subtitle);
  expect(stored?.card?.summaryCode).toBe(event.summaryCode);
  expect(stored?.card?.summaryParams).toEqual(sent.card?.summaryParams);
  return JSON.parse(JSON.stringify(stored));
}

function expectDetails(message: Message, detail: string) {
  expect(approvalDetailText(message.card!)).toBe(detail);
  const [pending] = pendingApprovals([message]);
  expect(pending?.detail).toBe(detail);
  expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain(detail);
  expect(renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0 }))).toContain(detail);
  expect(spokenApprovalPrompt(pending!, "Scout")).toContain(detail);
}

afterEach(() => {
  setLocale("en");
  vi.unstubAllEnvs();
});

describe("approval summary from driver event through persisted card to renderer", () => {
  it.each([
    ["github", "", "github asks to continue", "github pede para continuar"],
    ["", "", "An MCP server asks to continue", "Um servidor MCP pede para continuar"],
    ["", "External words", "An MCP server: External words", "Um servidor MCP: External words"],
    ["github", "External words", "github: External words", "github: External words"],
  ])("renders and speaks Claude's %s / %s without rewriting provider text", (server, words, english, portuguese) => {
    const event = claudeRequest(server!, words!);
    const message = persistedRequest(event);
    expect(message.card?.subtitle).toBe(english);
    expectDetails(message, english!);
    setLocale("pt-br");
    expectDetails(message, portuguese!);
    expect(message.card?.subtitle).toBe(english);
  });

  it.each([undefined, "Allow ChatGPT to use Safari?"])("renders and speaks Codex's real app-access event for %j", async (message) => {
    vi.stubEnv("FAKE_CODEX_MODE", "approval");
    vi.stubEnv("FAKE_CODEX_APPROVAL_REQUEST", JSON.stringify({
      method: "mcpServer/elicitation/request",
      params: {
        mode: "form", message, _meta: { app_name: "Safari" },
        requestedSchema: { properties: { approval: { enum: ["once"] } }, required: ["approval"] },
      },
    }));
    const instance = await CodexDriver.create({
      instanceId: "approval-contract", displayName: "Fixture", enabled: true, environment: {},
      config: { cli: fileURLToPath(new URL("../../server/testing/fake-codex-app-server.ts", import.meta.url)), fullAuto: false },
    });
    const recorder = recordEvents(instance.adapter);
    try {
      const threadId = randomUUID();
      await instance.adapter.sendTurn({ threadId, text: "use Safari" });
      const event = await recorder.until((candidate) => candidate.type === "request.opened");
      if (event.type !== "request.opened") throw new Error("Expected an approval request");
      const received = persistedRequest(event);
      expect(received.card?.summaryCode).toBe(message ? undefined : "chat.notice.appAccessRequested");
      expectDetails(received, message ?? "App access requested");
      setLocale("pt-br");
      expectDetails(received, message ?? "Pedido de acesso ao app");
      expect(received.card?.subtitle).toBe(message ?? "App access requested");
      await instance.adapter.respondToRequest(threadId, event.requestId!, { behavior: "deny" });
      await recorder.until((candidate) => candidate.type === "turn.completed");
    } finally {
      recorder.stop();
      await instance.dispose();
    }
  });

  it("rewords an already collected pending approval when the language changes", () => {
    const message = persistedRequest(claudeRequest("github", ""));
    const [pending] = pendingApprovals([message]);
    setLocale("pt-br");
    expect(spokenApprovalPrompt(pending!, "Scout")).toContain("github pede para continuar");
    expect(renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0 })))
      .toContain("github pede para continuar");
  });

  it("renders a canvas generation card's reason in the person's language, from generation's own words only", () => {
    const threadId = randomUUID();
    const english = "A bot may start 3 videos a day without you, and this one has started 3. Confirm to let it make 1 more.";
    const sent = new Store(selection).appendMessage(threadId, { role: "bot", kind: "options", card: {
      title: "Generate “Poster”?", subtitle: english, options: ["Confirm", "Cancel"], requestId: "r1", tool: "canvas_generate", fixedOptions: true,
      canvasGeneration: { requestId: "r1", projectId: "p1", nodeId: "n1", title: "Poster", botId: "b1", threadId, reasonKey: "serverError.projectGeneration.confirmVideos", reasonParams: { ceiling: 3, used: 3, asked: 1 }, createdAt: 1 },
    } });
    const message = JSON.parse(JSON.stringify(readMessage(threadId, sent.id))) as Message;
    const shows = (detail: string) => {
      expect(approvalDetailText(message.card!)).toBe(detail);
      const [pending] = pendingApprovals([message]);
      expect(pending?.detail).toBe(detail);
      expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain(detail);
      const panel = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0 }));
      expect(panel).toContain("Generate “Poster”?");
      expect(panel).toContain(detail);
    };
    shows(english);
    setLocale("zh");
    shows("一个机器人每天最多可以不经你确认发起 3 个视频，这个机器人已经发起了 3 个。确认后，它可以再生成 1 个。");
    message.card!.canvasGeneration!.reasonKey = "approval.someone";
    shows(english);
  });

  it("tells a refusal after Confirm on the card in the person's language with its values, scrubbed of secrets when stored", () => {
    const threadId = randomUUID();
    const english = "This project already has 50 generations waiting or running. Wait for some of them to finish.";
    const stored = (heldParams: Record<string, string | number>) => {
      const requestId = randomUUID();
      const sent = new Store(selection).appendMessage(threadId, { role: "bot", kind: "options", card: {
        title: "Generate “Poster”?", subtitle: "A bot may start 3 videos a day without you.", options: ["Confirm", "Cancel"], requestId, tool: "canvas_generate",
        fixedOptions: true, answered: "allow", held: english, heldCode: "serverError.projectGeneration.tooMany", heldParams,
        canvasGeneration: {
          requestId, projectId: "p1", nodeId: "n1", title: "Poster", botId: "b1", threadId, reasonKey: "serverError.projectGeneration.confirmVideos",
          reasonParams: { ceiling: 3, used: 3, asked: 1 }, createdAt: 1, result: { state: "refused", code: "too_many", error: english },
        },
      } });
      return JSON.parse(JSON.stringify(readMessage(threadId, sent.id))) as Message;
    };
    const message = stored({ count: 50 });
    const zh = "这个项目已经有 50 个生成任务在等待或进行中。请等其中一些完成。";
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain(english);
    setLocale("zh");
    expect(renderToStaticMarkup(createElement(ApprovalCard, { message }))).toContain(zh);
    const [pending] = pendingApprovals([{ ...message, card: { ...message.card!, answered: undefined } }]);
    expect(renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0 }))).toContain(zh);
    expect(stored({ count: `sk-${"c".repeat(24)}` }).card?.heldParams).toEqual({ count: "«redacted 27 chars»" });
  });

  it.each([undefined, "chat.notice.unknown", "approval.someone", "chat.notice.elicitationContinue"])("keeps the English fallback for a legacy, unknown, out-of-namespace or incomplete code %j", (summaryCode) => {
    const message = persistedRequest(claudeRequest("", ""));
    message.card!.summaryCode = summaryCode;
    setLocale("pt-br");
    expectDetails(message, "An MCP server asks to continue");
  });

  it("scrubs coded card params at the persistence boundary too", () => {
    const secret = `sk-${"b".repeat(24)}`;
    const event = claudeRequest("", "External words");
    event.summary = `An MCP server: ${secret}`;
    event.summaryParams = { message: secret };
    const message = persistedRequest(event);
    expect(JSON.stringify(message)).not.toContain(secret);
    expect(message.card?.summaryParams?.message).toBe("«redacted 27 chars»");
    setLocale("pt-br");
    expectDetails(message, "Um servidor MCP: «redacted 27 chars»");
  });

  it("keeps secrets out of both the stored fallback and its params", () => {
    const secret = `sk-${"a".repeat(24)}`;
    const event = claudeRequest("", secret);
    const message = persistedRequest(event);
    expect(JSON.stringify(message)).not.toContain(secret);
    expect(message.card?.summaryParams?.message).toBe("«redacted 27 chars»");
    setLocale("pt-br");
    expectDetails(message, "Um servidor MCP: «redacted 27 chars»");
  });
});
