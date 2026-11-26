import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Mounts each test's card into a fresh page in English, and unmounts it after. */
export function useBoardPage(): void {
  beforeEach(() => {
    setLocale("en");
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });
}

export function render(element: ReactElement): HTMLElement {
  act(() => root!.render(element));
  return host!.firstElementChild as HTMLElement;
}

export function click(element: Element | null | undefined): void {
  if (!element) throw new Error("nothing to click");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

export function press(element: Element | null | undefined, key: string): void {
  if (!element) throw new Error("nothing to press on");
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}

export const buttonNamed = (scope: ParentNode, name: string): HTMLButtonElement | undefined =>
  [...scope.querySelectorAll("button")].find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name);

/** The text a reader sees, a space between the text of separate elements. */
export function textOf(element: Element | null | undefined): string {
  if (!element) return "";
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
