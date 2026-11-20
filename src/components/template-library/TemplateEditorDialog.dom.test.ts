// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATE_LIMITS, type TeamTemplateWire, type TemplateRole } from "../../../shared/template-library";

const sent: Array<{ path: string; method: string; body?: unknown }> = [];
let answer: (path: string, method: string) => Promise<unknown> = async () => ({ bots: [], teams: [] });
vi.mock("@/state/api", async (original) => ({
  ...(await original<typeof import("@/state/api")>()),
  api: vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    sent.push({ path, method, ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}) });
    return answer(path, method);
  }),
}));
const { ApiError } = await import("@/state/api");
const { t } = await import("@/lib/i18n");
const { blankTeamDraft, teamDraftOf, withNewRole } = await import("@/lib/template-library-draft");
const { currentTemplateLibrary, editTemplate, forgetDiscardedTemplate, TEAM_PAGE, templateSaved, useTemplateLibrary } = await import("@/state/template-library");
const { TemplateEditorDialog } = await import("./TemplateEditorDialog");

const role = (fields: Partial<TemplateRole> & Pick<TemplateRole, "key" | "name">): TemplateRole => ({
  title: "", description: "", soul: "", memory: "", ownSkills: [], librarySkills: [], look: { color: "blue" }, ...fields,
});
const urban = (): TeamTemplateWire => ({
  id: "tm_1", name: "Urban crew", genre: "City romance", version: 2, updatedAt: 1, lead: "director", context: "Episodes of two minutes.",
  roles: [role({ key: "picker", name: "Book picker" }), role({ key: "director", name: "Director" })], skills: [], carried: { groupChats: 0, routines: 0 },
});

function Host() {
  const { editing } = useTemplateLibrary();
  return editing ? createElement(TemplateEditorDialog, { editing, botTemplates: [] }) : null;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(Host)));
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  templateSaved();
  forgetDiscardedTemplate();
  sent.length = 0;
  answer = async () => ({ bots: [], teams: [] });
});

const find = <Found extends HTMLElement>(selector: string): Found => {
  const found = container.querySelector<Found>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
};
const type = (field: HTMLInputElement | HTMLTextAreaElement, text: string) => flushSync(() => {
  const owner = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(owner, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const press = (control: HTMLElement) => flushSync(() => control.click());
const saveButton = () => find<HTMLButtonElement>("[data-template-save]");
const footer = () => find("footer").textContent ?? "";
const openSaved = () => flushSync(() => editTemplate({ kind: "team", id: "tm_1", changed: false, draft: teamDraftOf(urban()), shown: TEAM_PAGE, carried: urban().carried }));
const openNew = () => flushSync(() => editTemplate({ kind: "team", changed: false, draft: blankTeamDraft(), shown: TEAM_PAGE, carried: { groupChats: 0, routines: 0 } }));

describe("the team template editor", () => {
  it("offers Save for a saved template only once something changed, and saves it as the same template", async () => {
    openSaved();
    expect(saveButton().disabled, "a save without a change would only raise the version").toBe(true);
    expect(document.activeElement, "nothing to fill in first").toBe(find("[data-template-editor]"));

    type(find<HTMLTextAreaElement>("[data-template-genre]"), "City romance and office comebacks");
    expect(saveButton().disabled).toBe(false);
    answer = async () => ({ template: { ...urban(), version: 3 } });
    press(saveButton());
    await vi.waitFor(() => expect(currentTemplateLibrary().editing).toBeNull());
    expect(sent.find((each) => each.method === "PUT")).toMatchObject({
      path: "/api/template-library/teams/tm_1",
      body: { name: "Urban crew", genre: "City romance and office comebacks", lead: "director", roles: [{ key: "picker" }, { key: "director" }] },
    });
    expect(currentTemplateLibrary().discarded, "a saved template leaves nothing to go on with").toBeNull();
  });

  it("says what keeps a new template from being saved, and starts in its name", () => {
    openNew();
    const name = find<HTMLInputElement>("[data-template-name]");
    expect(document.activeElement).toBe(name);
    expect(saveButton().disabled).toBe(true);
    expect(footer()).toContain(t("templateLibrary.needs.name"));

    type(name, "Costume drama crew");
    expect(footer()).toContain(t("templateLibrary.needs.roleName"));
    expect(saveButton().disabled).toBe(true);
  });

  it("names a field by its caption alone: the hint describes it", () => {
    openSaved();
    const genre = find<HTMLTextAreaElement>("[data-template-genre]");
    const hint = document.getElementById(genre.getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toBe(t("templateLibrary.team.genreHint"));
    expect(genre.closest("label")!.contains(hint)).toBe(false);

    const context = find<HTMLTextAreaElement>("[data-template-context]");
    expect(context.hasAttribute("aria-describedby")).toBe(false);
    type(context, "长".repeat(8001));
    expect(context.getAttribute("aria-invalid")).toBe("true");
    const size = document.getElementById(context.getAttribute("aria-describedby")!)!;
    expect(size.textContent).toContain("24,003");
    expect(context.closest("label")!.contains(size)).toBe(false);
    expect(footer()).toContain(t("templateLibrary.needs.context"));
    expect(saveButton().disabled).toBe(true);
  });

  it("keeps a refused save on screen in the app's own sentence, with the focus inside", async () => {
    openSaved();
    type(find<HTMLInputElement>("[data-template-name]"), "Costume drama crew");
    answer = async (_path, method) => {
      if (method === "PUT") throw new ApiError("A template called Costume drama crew already exists. Choose another name.", 409);
      return { bots: [], teams: [] };
    };
    saveButton().focus();
    press(saveButton());
    await vi.waitFor(() => expect(container.querySelector("footer [role=alert]")?.textContent).toBe("A template called Costume drama crew already exists. Choose another name."));
    expect(currentTemplateLibrary().editing).not.toBeNull();
    expect(saveButton().disabled).toBe(false);
    expect(document.activeElement).toBe(find("[data-template-editor]"));
  });

  it("lists the team and its roles with the lead marked, and offers no more roles than a template holds", () => {
    openSaved();
    const pages = [...find("[data-template-nav]").querySelectorAll("button")].map((each) => each.textContent);
    expect(pages).toEqual([t("templateLibrary.nav.team"), "Book picker", `Director${t("templateLibrary.lead")}`]);
    expect(find("[data-template-nav] [aria-current=page]").textContent).toBe(t("templateLibrary.nav.team"));
    const add = find<HTMLSelectElement>("[data-template-nav] select");
    expect(add.disabled).toBe(false);

    let full = blankTeamDraft();
    while (full.roles.length < TEMPLATE_LIMITS.roles) full = withNewRole(full).draft;
    flushSync(() => editTemplate({ kind: "team", changed: true, draft: { ...full, name: "Everyone" }, shown: TEAM_PAGE, carried: { groupChats: 0, routines: 0 } }));
    const closed = find<HTMLSelectElement>("[data-template-nav] select");
    expect(closed.disabled).toBe(true);
    expect(closed.title).toBe(t("templateLibrary.addRole.full", { count: "30" }));
  });

  it("closes without asking and keeps unsaved changes within reach", () => {
    openSaved();
    press(find(`button[aria-label="${t("common.close")}"]`));
    expect(currentTemplateLibrary()).toMatchObject({ editing: null, discarded: null });

    openSaved();
    type(find<HTMLInputElement>("[data-template-name]"), "Urban crew, second unit");
    container.querySelector("[data-template-editor]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(currentTemplateLibrary().editing).toBeNull();
    expect(currentTemplateLibrary().discarded).toMatchObject({ id: "tm_1", changed: true, draft: { name: "Urban crew, second unit" } });
  });
});
