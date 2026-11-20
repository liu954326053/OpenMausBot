// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { initialState, type Action, type AppState } from "./state/store";

let state: AppState = { ...initialState, connected: true, hydrated: true };
let dispatched: Action[] = [];
const track = vi.fn();
vi.mock("./state/store", async (original) => ({
  ...await original<typeof import("./state/store")>(),
  StoreProvider: ({ children }: { children: unknown }) => children,
  useStore: () => ({ state, dispatch: (action: Action) => { dispatched.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));
vi.mock("./lib/analytics", () => ({ initAnalytics: () => {}, track: (...args: unknown[]) => track(...args), emailGateDone: () => true }));
const { default: App } = await import("./App");

function render(cloudAdd: AppState["cloudAdd"], ogb?: unknown, config: AppState["config"] = null): { opened: ReturnType<typeof vi.fn>; done: () => void } {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const opened = vi.fn(() => null);
  vi.stubGlobal("open", opened);
  if (ogb) (window as { ogb?: unknown }).ogb = ogb;
  state = { ...initialState, connected: true, hydrated: true, cloudAdd, config };
  dispatched = []; track.mockClear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(App)));
  return { opened, done: () => { root.unmount(); container.remove(); } };
}

afterEach(() => { delete (window as { ogb?: unknown }).ogb; vi.unstubAllGlobals(); });

it("in a browser off a Cloud, a Cloud request opens no checkout and leaves nothing waiting", () => {
  const { opened, done } = render({ source: "app_onboarding" });
  try {
    expect(opened).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith("cloud_checkout_opened", expect.anything());
    expect(dispatched).toContainEqual({ type: "closeCloudAdd" });
  } finally { done(); }
});

it("on a Cloud's own page, it opens the Cloud website's page for the account in the same tap and counts it", () => {
  const { opened, done } = render({ source: "app_onboarding" }, undefined, { cloudHome: true } as AppState["config"]);
  try {
    expect(opened).toHaveBeenCalledExactlyOnceWith("https://cloud.openmausbot.com/cloud?src=app_onboarding", "_blank", "noopener,noreferrer");
    expect(track).toHaveBeenCalledWith("cloud_checkout_opened", { source: "app_onboarding", via: "cloud_page" });
    expect(dispatched).toContainEqual({ type: "closeCloudAdd" });
  } finally { done(); }
});

it("on a desktop showing another computer that is no Cloud, it opens nothing", () => {
  const openExternal = vi.fn(async () => {});
  const { opened, done } = render({ source: "app_card" }, { remoteClient: { active: true }, cloudAccount: {}, openExternal });
  try {
    expect(openExternal).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    expect(dispatched).toContainEqual({ type: "closeCloudAdd" });
  } finally { done(); }
});

it("on the desktop's own page the Add a Cloud dialog takes it, as before", () => {
  const openExternal = vi.fn(async () => {});
  const { opened, done } = render({ source: "app_onboarding" }, { cloudAccount: {}, openExternal });
  try {
    expect(opened).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith("cloud_checkout_opened", expect.anything());
    expect(dispatched).not.toContainEqual({ type: "closeCloudAdd" });
  } finally { done(); }
});
