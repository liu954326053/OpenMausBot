import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TemplateLibraryWire } from "../../shared/template-library";

const reads: Array<{ resolve: (library: TemplateLibraryWire) => void; reject: (cause: unknown) => void }> = [];
vi.mock("../lib/template-library", () => ({
  listTemplates: () => new Promise<TemplateLibraryWire>((resolve, reject) => { reads.push({ resolve, reject }); }),
}));
const { blankBotDraft, blankTeamDraft } = await import("../lib/template-library-draft");
const {
  changeEditedTemplate, closeTemplateEditor, currentTemplateLibrary, editTemplate, forgetDiscardedTemplate, refreshTemplateLibrary, TEAM_PAGE,
  templateSaved,
} = await import("./template-library");
type TeamTemplateEditing = import("./template-library").TeamTemplateEditing;
type BotTemplateEditing = import("./template-library").BotTemplateEditing;

const library = (name: string): TemplateLibraryWire => ({ bots: [], teams: [{ id: name, name, genre: "", version: 1, updatedAt: 1, lead: "a", roles: [] }] });
const team = (changed = false): TeamTemplateEditing => ({ kind: "team", changed, draft: blankTeamDraft(), shown: TEAM_PAGE, carried: { groupChats: 0, routines: 0 } });
const named = (name: string) => (editing: TeamTemplateEditing): TeamTemplateEditing => ({ ...editing, changed: true, draft: { ...editing.draft, name } });

beforeEach(() => {
  reads.length = 0;
  templateSaved();
});

describe("the list of templates", () => {
  it("is what the last read answered", async () => {
    const read = refreshTemplateLibrary();
    reads[0]!.resolve(library("first"));
    await read;
    expect(currentTemplateLibrary()).toMatchObject({ library: library("first"), failed: false });
  });

  it("keeps what it had when a read fails, says so, and is whole again after the next read", async () => {
    const good = refreshTemplateLibrary();
    reads[0]!.resolve(library("kept"));
    await good;
    const bad = refreshTemplateLibrary();
    reads[1]!.reject(new TypeError("Failed to fetch"));
    await bad;
    expect(currentTemplateLibrary()).toMatchObject({ library: library("kept"), failed: true });
    const again = refreshTemplateLibrary();
    reads[2]!.resolve(library("fresh"));
    await again;
    expect(currentTemplateLibrary()).toMatchObject({ library: library("fresh"), failed: false });
  });

  it("shows the later of two reads on their way, whichever answers first", async () => {
    const earlier = refreshTemplateLibrary();
    const later = refreshTemplateLibrary();
    reads[1]!.resolve(library("later"));
    await later;
    reads[0]!.resolve(library("earlier"));
    await earlier;
    expect(currentTemplateLibrary().library).toEqual(library("later"));
  });

  it("is not marked failed by an earlier read that fails after a later one answered", async () => {
    const earlier = refreshTemplateLibrary();
    const later = refreshTemplateLibrary();
    reads[1]!.resolve(library("later"));
    await later;
    reads[0]!.reject(new Error("late failure"));
    await earlier;
    expect(currentTemplateLibrary()).toMatchObject({ library: library("later"), failed: false });
  });
});

describe("the template being edited", () => {
  it("takes each change from the one before it, also two in a row", () => {
    editTemplate(team());
    changeEditedTemplate<TeamTemplateEditing>("team", named("Urban"));
    changeEditedTemplate<TeamTemplateEditing>("team", (editing) => ({ ...editing, draft: { ...editing.draft, name: `${editing.draft.name} crew` } }));
    expect(currentTemplateLibrary().editing).toMatchObject({ kind: "team", changed: true, draft: { name: "Urban crew" } });
  });

  it("ignores a change meant for the other kind of template, or for an editor already closed", () => {
    editTemplate(team());
    const before = currentTemplateLibrary().editing;
    changeEditedTemplate<BotTemplateEditing>("bot", (editing) => ({ ...editing, changed: true }));
    expect(currentTemplateLibrary().editing).toBe(before);
    templateSaved();
    changeEditedTemplate<TeamTemplateEditing>("team", named("Too late"));
    expect(currentTemplateLibrary().editing).toBeNull();
  });

  it("stays within reach after the editor closes with changes, until the page lets it go", () => {
    editTemplate(team());
    changeEditedTemplate<TeamTemplateEditing>("team", named("Urban crew"));
    closeTemplateEditor();
    const { editing, discarded } = currentTemplateLibrary();
    expect(editing).toBeNull();
    expect(discarded).toMatchObject({ kind: "team", draft: { name: "Urban crew" } });
    editTemplate(discarded!);
    expect(currentTemplateLibrary()).toMatchObject({ editing: { draft: { name: "Urban crew" } }, discarded: null });
    closeTemplateEditor();
    forgetDiscardedTemplate();
    expect(currentTemplateLibrary()).toMatchObject({ editing: null, discarded: null });
  });

  it("leaves nothing behind when the editor closes unchanged, or after a save", () => {
    editTemplate({ kind: "bot", changed: false, draft: blankBotDraft() });
    closeTemplateEditor();
    expect(currentTemplateLibrary()).toMatchObject({ editing: null, discarded: null });
    editTemplate(team(true));
    templateSaved();
    expect(currentTemplateLibrary()).toMatchObject({ editing: null, discarded: null });
  });

  it("replaces what an earlier editor left behind when another template is opened", () => {
    editTemplate(team(true));
    closeTemplateEditor();
    editTemplate({ kind: "bot", changed: false, draft: blankBotDraft() });
    expect(currentTemplateLibrary()).toMatchObject({ editing: { kind: "bot" }, discarded: null });
  });
});
