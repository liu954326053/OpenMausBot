// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLocale, setLocale } from "@/lib/i18n";
import { AttentionThreadRows } from "./SidebarBotActivity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
beforeEach(() => { root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  setLocale("en");
});

describe("the Inbox's active list", () => {
  it("names a conversation that has no title yet in the person's language", async () => {
    await loadLocale("zh");
    await act(async () => {
      root.render(createElement(AttentionThreadRows, {
        entries: [{ kind: "bot", botId: "eli", botName: "Eli", task: { threadId: "t1", title: "New thread", createdAt: 1, updatedAt: 1, queued: false, busy: true } }],
        inset: true, onJump: () => undefined,
      }));
    });
    const row = document.querySelector("button")!;
    expect(row.textContent).toContain("未命名对话");
    expect(row.textContent).not.toContain("New thread");
    expect(row.getAttribute("aria-label")).toContain("未命名对话");
  });
});
