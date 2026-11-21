// @vitest-environment happy-dom
import { createElement, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireGroup } from "../../shared/wire";
import type { Action, AppState } from "./store";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

const group = {
  id: "launch", threadId: "launch-thread", name: "Launch room", memberIds: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false,
  createdAt: 1, messages: [],
} as unknown as WireGroup;

let answerDelete: () => Promise<Response>;
const writes: Array<{ path: string; method: string }> = [];
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const { StoreProvider, useStore } = await import("./store");

let seen!: AppState;
let dispatch!: Dispatch<Action>;
function Probe() {
  ({ state: seen, dispatch } = useStore());
  return null;
}
let root: Root;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeAll(async () => {
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, options?: RequestInit) => {
    if (options?.method && options.method !== "GET") writes.push({ path, method: options.method });
    if (path.startsWith("/api/bots?")) return json({ bots: [], groups: [group] });
    if (path === "/api/groups/launch" && options?.method === "DELETE") return answerDelete();
    return json({});
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
  FixtureEventSource.opened[0].send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
});
beforeEach(() => {
  writes.length = 0;
  flushSync(() => dispatch({ type: "error", message: null }));
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
});

describe("deleting a group chat", () => {
  it("asks the server to delete it and keeps it listed until the server says it is gone", async () => {
    answerDelete = () => json({ ok: true });
    expect(seen.groups.map((one) => one.id)).toEqual(["launch"]);
    flushSync(() => dispatch({ type: "deleteGroup", groupId: "launch" }));
    await settle();
    expect(writes).toEqual([{ path: "/api/groups/launch", method: "DELETE" }]);
    expect(seen.groups.map((one) => one.id)).toEqual(["launch"]);
    expect(seen.error).toBeNull();
  });

  it("shows the server's refusal", async () => {
    answerDelete = () => json({ error: "this channel is working — stop that turn first" }, 409);
    flushSync(() => dispatch({ type: "deleteGroup", groupId: "launch" }));
    await settle();
    expect(writes).toEqual([{ path: "/api/groups/launch", method: "DELETE" }]);
    expect(seen.error).toContain("stop that turn first");
    expect(seen.groups.map((one) => one.id)).toEqual(["launch"]);
  });
});
