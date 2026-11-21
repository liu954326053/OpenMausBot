// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [], groups: [] }, dispatch: fixture.dispatch }),
  api: fixture.api,
}));

const { DeleteDepartmentDialog } = await import("./TeamMapDepartment");

let root: Root;
let host: HTMLElement;
const onClose = vi.fn();
const onError = vi.fn();
const render = (department: string | null) => flushSync(() => root.render(createElement(DeleteDepartmentDialog, { department, onClose, onError })));
const dialog = () => document.body.querySelector<HTMLElement>("[role=alertdialog]");
const button = (label: string) => [...dialog()!.querySelectorAll("button")].find((each) => each.textContent === label)!;
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  onClose.mockReset();
  onError.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("deleting a department from the team map", () => {
  it("sends one request however often it is pressed, and holds the dialog until the server answers", async () => {
    let answer!: (value: { sections: string[] }) => void;
    fixture.api.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render("Launch");
    expect(dialog()?.textContent).toContain("Delete Launch department?");
    flushSync(() => { button("Delete department").click(); button("Delete department").click(); });
    expect(fixture.api).toHaveBeenCalledTimes(1);
    expect(fixture.api).toHaveBeenCalledWith("/api/sidebar-sections?section=Launch", { method: "DELETE" });
    expect(dialog()?.getAttribute("aria-busy")).toBe("true");
    expect([...dialog()!.querySelectorAll("button")].every((each) => each.disabled)).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();

    answer({ sections: ["Research"] });
    await settle();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "sectionDeleted", section: "Launch", sections: ["Research"] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open after a failure, says why, and can be pressed again", async () => {
    fixture.api.mockRejectedValueOnce(new Error("Fixture deletion failure")).mockResolvedValueOnce({ sections: [] });
    render("Launch");
    flushSync(() => button("Delete department").click());
    await settle();
    expect(onError).toHaveBeenCalledWith("Fixture deletion failure");
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()?.getAttribute("aria-busy")).toBe("false");

    flushSync(() => button("Delete department").click());
    await settle();
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is closed while no department is being deleted", () => {
    render(null);
    expect(dialog()).toBeNull();
  });
});
