import { describe, expect, it } from "vitest";

import { TEAM_BRIEF_MAX_BYTES } from "../../shared/package-format";
import { TEMPLATE_LIMITS, type BotTemplateWire, type TeamTemplateWire, type TemplateOwnSkill, type TemplateRole } from "../../shared/template-library";
import { MAUS_COLOR_NAMES } from "../../shared/wire";
import {
  blankBotDraft, blankRole, blankTeamDraft, botDraftOf, botSaveBlock, botTemplateInput, hasRoomForRole, patchedRole, roleDraftOf, standInBot, teamDraftOf,
  teamSaveBlock, teamTemplateInput, withLibrarySkill, withNewRole, withoutLibrarySkill, withoutOwnSkill, withoutRole, withRole, withRoleBack,
  withRoleFromBotTemplate, type RoleDraft, type TeamDraft,
} from "./template-library-draft";

const PICTURE = "data:image/webp;base64,AAAA";

const role = (fields: Partial<TemplateRole> & Pick<TemplateRole, "key" | "name">): TemplateRole => ({
  title: "", description: "", soul: "", memory: "", ownSkills: [], librarySkills: [], look: { color: "blue" }, ...fields,
});
const skill = (name: string, text = `# ${name}`): TemplateOwnSkill => ({ name, description: `${name} in a line`, text });

const team = (fields: Partial<TeamTemplateWire> = {}): TeamTemplateWire => ({
  id: "tm_1", name: "Urban crew", genre: "City romance", version: 3, updatedAt: 1, lead: "director", context: "Episodes of two minutes.",
  roles: [role({ key: "picker", name: "Book picker" }), role({ key: "director", name: "Director", title: "Runs the team" })],
  skills: [], carried: { groupChats: 0, routines: 0 }, ...fields,
});
const botTemplate = (fields: Partial<TemplateRole> = {}, skills: TemplateOwnSkill[] = []): BotTemplateWire => {
  const its = role({ key: "writer", name: "Script writer", title: "Writes episodes", ...fields });
  return { id: "bt_1", name: its.name, title: its.title, version: 2, updatedAt: 1, role: its, skills };
};

const named = (draft: TeamDraft, name: string): RoleDraft => draft.roles.find((each) => each.name === name)!;
const keys = (draft: TeamDraft): string[] => teamTemplateInput(draft).roles.map((each) => each.key);

describe("a template opened for editing and saved again", () => {
  it("sends a team back as it was read: its roles in order, their keys, and the lead by key", () => {
    const template = team({
      roles: [
        role({ key: "picker", name: "Book picker", librarySkills: ["find-books"], mcpServers: ["search"], memory: "Likes thrillers." }),
        role({ key: "director", name: "Director", soul: "Decides.", model: { instanceId: "claude", model: "opus", effort: "high" },
          look: { color: "red", mascotExpression: "wink", mascotFaceColor: "black" } }),
      ],
    });
    const { id: _id, version: _version, updatedAt: _updatedAt, carried: _carried, ...sent } = template;
    expect(teamTemplateInput(teamDraftOf(template))).toEqual(sent);
  });

  it("sends a bot template back as it was read", () => {
    const template = botTemplate({ ownSkills: ["storyboard"], look: { color: "teal", picture: PICTURE, pictureCrop: "rounded", avatarZoom: 2, avatarFocusX: 0.2, avatarFocusY: 0.7 } }, [skill("storyboard")]);
    expect(botTemplateInput(botDraftOf(template))).toEqual({ role: template.role, skills: template.skills });
  });

  it("names every role anew on the page, so two openings of one template never share a role", () => {
    const [first, second] = [teamDraftOf(team()), teamDraftOf(team())];
    expect(new Set([...first.roles, ...second.roles].map((each) => each.id)).size).toBe(4);
    expect(first.lead).toBe(named(first, "Director").id);
  });

  it("lets the first role lead a template whose lead is not one of its roles", () => {
    const draft = teamDraftOf(team({ lead: "gone" }));
    expect(draft.lead).toBe(draft.roles[0]!.id);
    expect(teamTemplateInput(draft).lead).toBe("picker");
  });

  it("trims the names and the genre, and leaves the context as typed", () => {
    const draft = { ...blankTeamDraft(), name: "  Ancient crew ", genre: " Palace intrigue\n", context: "  Indented on purpose.\n" };
    const sent = teamTemplateInput(withRole(draft, { ...draft.roles[0]!, name: " Director ", title: " Leads " }));
    expect(sent).toMatchObject({ name: "Ancient crew", genre: "Palace intrigue", context: "  Indented on purpose.\n", roles: [{ name: "Director", title: "Leads" }] });
  });
});

describe("a role's key", () => {
  it("is made from the role's name at its first save, and is one no other role has", () => {
    let draft = teamDraftOf(team());
    for (const name of ["Director", "Shot designer", "选书"]) {
      const added = withNewRole(draft);
      draft = withRole(added.draft, { ...named(added.draft, ""), name });
    }
    expect(keys(draft)).toEqual(["picker", "director", "director-2", "shot-designer", "role-1"]);
  });

  it("stays what it was when the role is renamed", () => {
    const draft = teamDraftOf(team());
    const renamed = withRole(draft, { ...named(draft, "Book picker"), name: "Novel scout" });
    expect(teamTemplateInput(renamed).roles[0]).toMatchObject({ key: "picker", name: "Novel scout" });
  });

  it("is never one a later role already has", () => {
    const draft = teamDraftOf(team());
    const added = withNewRole(draft);
    const first = { ...added.draft, roles: [{ ...named(added.draft, ""), name: "Director" }, ...draft.roles] };
    expect(keys(first)).toEqual(["director-2", "picker", "director"]);
  });

  it("is never one a role removed while editing had, nor one the template retired before", () => {
    const draft = teamDraftOf(team({ roles: [role({ key: "role-1", name: "制片人" }), role({ key: "role-2", name: "选书" })], lead: "role-1", retiredKeys: ["role-3"] }));
    const added = withNewRole(withoutRole(draft, named(draft, "选书").id));
    const renamed = withRole(added.draft, { ...named(added.draft, ""), name: "镜头脚本设计" });
    expect(keys(renamed)).toEqual(["role-1", "role-4"]);
    const sameName = withRole(added.draft, { ...named(added.draft, ""), name: "选书" });
    expect(keys(sameName), "a new role is another role, whatever it is called").toEqual(["role-1", "role-4"]);
  });

  it("names a bot template's one role too", () => {
    expect(botTemplateInput({ role: { ...blankRole(), name: "Script writer" }, skills: [] }).role.key).toBe("script-writer");
    expect(botTemplateInput({ role: { ...blankRole(), name: "剧本编写" }, skills: [] }).role.key).toBe("role-1");
  });
});

describe("the roles of a team", () => {
  it("start as one blank role that leads", () => {
    const draft = blankTeamDraft();
    expect(draft.roles).toHaveLength(1);
    expect(draft.lead).toBe(draft.roles[0]!.id);
    expect(blankBotDraft().role).toMatchObject({ name: "", look: { color: "green", shape: "mascot" } });
  });

  it("gain a blank role at the end, in the next colour, and stop at the most a template holds", () => {
    let draft = blankTeamDraft();
    const added = withNewRole(draft);
    expect(added.draft.roles.map((each) => each.look.color)).toEqual(["green", "blue"]);
    expect(added.draft.roles.at(-1)!.id).toBe(added.id);
    expect(added.draft.lead).toBe(draft.lead);
    while (hasRoomForRole(draft)) draft = withNewRole(draft).draft;
    expect(draft.roles).toHaveLength(TEMPLATE_LIMITS.roles);
  });

  it("give a new role a colour none of the others wears while there is one, and go round again after that", () => {
    const three = withNewRole(withNewRole(blankTeamDraft()).draft).draft;
    expect(three.roles.map((each) => each.look.color)).toEqual(["green", "blue", "red"]);
    const afterRemoval = withNewRole(withoutRole(three, three.roles[1]!.id)).draft;
    expect(afterRemoval.roles.map((each) => each.look.color), "not red twice").toEqual(["green", "red", "blue"]);

    let full = blankTeamDraft();
    while (full.roles.length < MAUS_COLOR_NAMES.length) full = withNewRole(full).draft;
    expect(new Set(full.roles.map((each) => each.look.color)).size).toBe(MAUS_COLOR_NAMES.length);
    expect(withNewRole(full).draft.roles.at(-1)!.look.color).toBe(MAUS_COLOR_NAMES[0]);
  });

  it("gain a copy of a bot template's role: the team's own, with a key of its own at the next save", () => {
    const draft = teamDraftOf(team());
    const added = withRoleFromBotTemplate(draft, botTemplate({ soul: "Writes tight scenes.", librarySkills: ["find-books"], model: { instanceId: "claude", model: "opus" } }));
    const copy = added.draft.roles.at(-1)!;
    expect(copy).toMatchObject({ id: added.id, name: "Script writer", title: "Writes episodes", soul: "Writes tight scenes.", librarySkills: ["find-books"] });
    expect(copy.key).toBeUndefined();
    expect(keys(added.draft)).toEqual(["picker", "director", "script-writer"]);
  });

  it("number a copied role whose name the team already uses, whatever its case", () => {
    const draft = teamDraftOf(team());
    const once = withRoleFromBotTemplate(draft, botTemplate({ name: "DIRECTOR" })).draft;
    const twice = withRoleFromBotTemplate(once, botTemplate({ name: "Director" })).draft;
    expect(twice.roles.map((each) => each.name)).toEqual(["Book picker", "Director", "DIRECTOR 2", "Director 3"]);
  });

  it("take the copied role's own skills along, and keep the team's copy of one it already carries under that name", () => {
    const draft = { ...teamDraftOf(team()), skills: [skill("storyboard", "the team's")] };
    const template = botTemplate({ ownSkills: ["storyboard", "dialogue"] }, [skill("storyboard", "the bot template's"), skill("dialogue"), skill("unused")]);
    const added = withRoleFromBotTemplate(draft, template).draft;
    expect(added.skills).toEqual([skill("storyboard", "the team's"), skill("dialogue")]);
    expect(added.roles.at(-1)!.ownSkills).toEqual(["storyboard", "dialogue"]);
  });

  it("lose a role, and the first role leads when the lead goes", () => {
    const draft = teamDraftOf(team());
    const without = withoutRole(draft, named(draft, "Director").id);
    expect(without.roles.map((each) => each.name)).toEqual(["Book picker"]);
    expect(without.lead).toBe(named(draft, "Book picker").id);
    expect(withoutRole(draft, named(draft, "Book picker").id).lead).toBe(draft.lead);
  });

  it("never lose their last role", () => {
    const draft = blankTeamDraft();
    expect(withoutRole(draft, draft.roles[0]!.id)).toBe(draft);
  });

  it("get a removed role back at its place, leading again if it led", () => {
    const draft = teamDraftOf(team({ roles: [role({ key: "a", name: "A" }), role({ key: "b", name: "B" }), role({ key: "c", name: "C" })], lead: "b" }));
    const gone = named(draft, "B");
    const back = withRoleBack(withoutRole(draft, gone.id), gone, 1, true);
    expect(back).toEqual(draft);
    expect(withRoleBack(back, gone, 1, true), "a second Undo adds nothing").toBe(back);
    const notLeading = withRoleBack(withoutRole(draft, gone.id), gone, 1, false);
    expect(notLeading.lead).toBe(named(draft, "A").id);
  });
});

describe("a role's skills", () => {
  it("are named once each from the skills library", () => {
    const first = withLibrarySkill(blankRole(), "find-books");
    expect(withLibrarySkill(first, "find-books")).toBe(first);
    expect(withLibrarySkill(first, "shot-list").librarySkills).toEqual(["find-books", "shot-list"]);
    expect(withoutLibrarySkill(first, "find-books").librarySkills).toEqual([]);
  });

  it("of the template's own are sent only while some role still has them", () => {
    const template = team({
      roles: [role({ key: "picker", name: "Book picker", ownSkills: ["storyboard"] }), role({ key: "director", name: "Director", ownSkills: ["storyboard", "dialogue"] })],
      skills: [skill("storyboard"), skill("dialogue")],
    });
    const draft = teamDraftOf(template);
    const director = withoutOwnSkill(withoutOwnSkill(named(draft, "Director"), "dialogue"), "storyboard");
    expect(teamTemplateInput(withRole(draft, director)).skills).toEqual([skill("storyboard")]);
    expect(teamTemplateInput(withoutRole(draft, named(draft, "Director").id)).skills).toEqual([skill("storyboard")]);
  });
});

describe("a role shown to the bot editors as a bot", () => {
  it("is a bot of this page only, with the role's words, look and model", () => {
    const draft = roleDraftOf(role({
      key: "writer", name: "Script writer", title: "Writes episodes", description: "Turns a novel into scenes.", soul: "Never pads.",
      model: { instanceId: "claude", model: "opus" }, mcpServers: ["search"],
      look: { color: "coral", mascotExpression: "wink", mascotFaceColor: "black", picture: PICTURE, pictureCrop: "square", avatarZoom: 2, avatarFocusX: 0.1, avatarFocusY: 0.9 },
    }));
    expect(standInBot(draft)).toMatchObject({
      id: draft.id, name: "Script writer", title: "Writes episodes", description: "Turns a novel into scenes.", soul: "Never pads.", color: "coral",
      mascotExpression: "wink", mascotFaceColor: "black", avatarUrl: PICTURE, avatarCrop: "square", avatarZoom: 2, avatarFocusX: 0.1, avatarFocusY: 0.9,
      modelSelection: { instanceId: "claude", model: "opus" }, mcpServers: ["search"], messages: [],
    });
  });

  it("is a mascot with the whole picture framed and no MCP list of its own when the role says nothing", () => {
    const bot = standInBot(blankRole());
    expect(bot).toMatchObject({ avatarUrl: null, avatarCrop: "mascot", avatarZoom: 1, avatarFocusX: 0.5, avatarFocusY: 0.5, mascotExpression: null, mascotBody: null, mascotFaceColor: null });
    expect(bot.modelSelection).toEqual({ instanceId: "", model: "" });
    expect("mcpServers" in bot).toBe(false);
  });

  it("shows a picture read without a shape in a circle", () => {
    expect(standInBot(roleDraftOf(role({ key: "a", name: "A", look: { color: "blue", picture: PICTURE } }))).avatarCrop).toBe("circle");
  });
});

describe("what a bot editor changes on that bot", () => {
  const start = (): RoleDraft => ({ ...blankRole(), name: "Script writer" });

  it("changes the role's words and leaves the rest alone", () => {
    const changed = patchedRole(start(), { title: "Writes episodes", soul: "Never pads." });
    expect(changed).toMatchObject({ name: "Script writer", title: "Writes episodes", soul: "Never pads.", description: "" });
    expect(patchedRole(changed, { description: "" }).description).toBe("");
  });

  it("gives the role a picture in the shape chosen, and keeps how it is framed", () => {
    const uploaded = patchedRole(start(), { avatarUrl: PICTURE, avatarCrop: "circle", avatarZoom: 1, avatarFocusX: 0.5, avatarFocusY: 0.5 });
    expect(uploaded.look).toMatchObject({ picture: PICTURE, shape: "circle" });
    const framed = patchedRole(patchedRole(uploaded, { avatarCrop: "rounded" }), { avatarZoom: 2.5, avatarFocusX: 0.3 });
    expect(framed.look).toMatchObject({ picture: PICTURE, shape: "rounded", avatarZoom: 2.5, avatarFocusX: 0.3, avatarFocusY: 0.5 });
  });

  it("goes back to the mascot when the picture is taken away", () => {
    const uploaded = patchedRole(start(), { avatarUrl: PICTURE, avatarCrop: "square" });
    const cleared = patchedRole(uploaded, { avatarUrl: null, avatarCrop: "mascot" });
    expect(cleared.look.shape).toBe("mascot");
    expect("picture" in cleared.look).toBe(false);
  });

  it("keeps a picture the role had while the mascot is shown, and saves the role without it", () => {
    const uploaded = patchedRole(start(), { avatarUrl: PICTURE, avatarCrop: "square", avatarZoom: 2 });
    const mascot = patchedRole(uploaded, { avatarCrop: "mascot" });
    expect(mascot.look).toMatchObject({ picture: PICTURE, shape: "mascot" });
    expect(botTemplateInput({ role: mascot, skills: [] }).role.look).toEqual({ color: "green" });
    expect(botTemplateInput({ role: patchedRole(mascot, { avatarCrop: "square" }), skills: [] }).role.look).toEqual({ color: "green", picture: PICTURE, pictureCrop: "square", avatarZoom: 2 });
  });

  it("saves a circle without naming it, as a circle is what a picture is shown in", () => {
    const uploaded = patchedRole(start(), { avatarUrl: PICTURE, avatarCrop: "circle" });
    expect(botTemplateInput({ role: uploaded, skills: [] }).role.look).toEqual({ color: "green", picture: PICTURE });
  });

  it("changes the mascot: its colour, expression, body and face, and clears the ones set back to none", () => {
    const dressed = patchedRole(start(), { color: "purple", mascotExpression: "wink", mascotFaceColor: "black" });
    expect(dressed.look).toMatchObject({ color: "purple", mascotExpression: "wink", mascotFaceColor: "black" });
    const reset = patchedRole(dressed, { mascotExpression: null, mascotFaceColor: null });
    expect(reset.look).toEqual({ color: "purple", shape: "mascot" });
  });

  it("gives the role a model of its own, and none again when the choice is cleared or names no model", () => {
    const chosen = patchedRole(start(), { modelSelection: { instanceId: "claude", model: "opus", effort: "high" } });
    expect(chosen.model).toEqual({ instanceId: "claude", model: "opus", effort: "high" });
    expect("model" in patchedRole(chosen, { modelSelection: null })).toBe(false);
    expect("model" in patchedRole(chosen, { modelSelection: { instanceId: "", model: "" } })).toBe(false);
    expect(patchedRole(chosen, { title: "Writes" }).model).toEqual(chosen.model);
  });

  it("gives the role an MCP list of its own, which may be empty, and none again when it is cleared", () => {
    const listed = patchedRole(start(), { mcpServers: ["search"] });
    expect(listed.mcpServers).toEqual(["search"]);
    expect(patchedRole(listed, { mcpServers: [] }).mcpServers).toEqual([]);
    expect("mcpServers" in patchedRole(listed, { mcpServers: undefined })).toBe(false);
  });
});

describe("what keeps a template from being saved", () => {
  it("is a team's missing name, then a role's, then a background longer than a team holds", () => {
    const draft = blankTeamDraft();
    expect(teamSaveBlock(draft)).toBe("name");
    const titled = { ...draft, name: "Urban crew" };
    expect(teamSaveBlock(titled)).toBe("roleName");
    const ready = withRole(titled, { ...titled.roles[0]!, name: "Director" });
    expect(teamSaveBlock(ready)).toBeNull();
    expect(teamSaveBlock(withNewRole(ready).draft)).toBe("roleName");
    expect(teamSaveBlock({ ...ready, name: "   " })).toBe("name");
    expect(teamSaveBlock({ ...ready, context: "字".repeat(TEAM_BRIEF_MAX_BYTES / 3) })).toBeNull();
    expect(teamSaveBlock({ ...ready, context: "字".repeat(TEAM_BRIEF_MAX_BYTES / 3 + 1) })).toBe("context");
  });

  it("is a bot template's missing name", () => {
    expect(botSaveBlock(blankBotDraft())).toBe("name");
    expect(botSaveBlock({ role: { ...blankRole(), name: "Script writer" }, skills: [] })).toBeNull();
  });
});
