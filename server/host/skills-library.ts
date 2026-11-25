import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { skillCalls, skillCommandTurnText } from "../../shared/skill-command.ts";
import { isSkillName } from "../../shared/skill-md.ts";
import { isSkillSwitchAction, type SkillRequestCardData, type SkillShareRecord } from "../../shared/skill-request.ts";
import { DATA_DIR, type AppConfig } from "../config.ts";
import { appendDecision } from "../decision-log.ts";
import { UNDO_STALE, type DirectApply } from "../direct-apply.ts";
import {
  importedSkillListings, importedSkillsFor, listedImportedSkills, nativeSkillFolders, readImportedSkillFile,
  readImportedSkills, type ImportedSkillView, type SkillTurnEngine,
} from "../imported-skills.ts";
import { isNativeSkillEnabled } from "../native-skill-choices.ts";
import { nativeSkillListing, nativeSkills, projectSkillListing, projectSkills, readNativeSkillFile, type NativeSkill } from "../native-skills.ts";
import { isMainBot } from "../peer-roster.ts";
import { redactSecretsInText } from "../redact.ts";
import { readSectionContext } from "../section-context.ts";
import { librarySkillFilePath, librarySkillsOnOffer, listLibrarySkills, readLibrarySkillFile, readSkillLibraryIndex, skillsLibraryEnabled } from "../skill-library.ts";
import { offeredSkillViews, listedOffers } from "../skill-library-offer.ts";
import { librarySkillFiles, ownSkillFiles, type StoredSkillFiles } from "../skill-side-files.ts";
import {
  shareLearnedSkill,
  shareLearnedSkillsMode,
  SHARED_REVISION_CHARS,
  sharedSkillEditable,
  undoSharedLearnedSkill,
  updateSharedLearnedSkill,
  type ShareBot,
} from "../skill-share.ts";
import { enabledSkillFiles, listSkills, readSkillFile, resolveBotSkills, syncSkillLinks, type SkillListing } from "../skills.ts";
import { renderSkillsIndex, dedupeSkillEntries, type SkillIndexEntry } from "../skills-index.ts";
import type { BotRecord, Message, Store } from "../store.ts";
import { claudeUserSkillsEnabled, settingsTurnFields } from "../turn-settings.ts";
import { typedWords } from "../typed-sends.ts";
import { supportsWorkspaceFiles, TASK_WORKSPACES_DIR } from "../workspace.ts";

type ReceiptArgs = {
  botId: string;
  threadId: string;
  applied?: boolean;
  previous?: SkillRequestCardData["previous"];
  shared?: SkillShareRecord;
  staged: {
    id: string;
    action: "create" | "update";
    name: string;
    gist: string;
    source: string;
    files: Array<{ path: string; content: string }>;
    sha256: string;
    warnings: string[];
  };
};

export interface SkillsLibraryHostDeps {
  store: Store;
  cfg: AppConfig;
  appendSkillRequestCard(args: ReceiptArgs): { requestId: string; summary: string };
  /** An engine instance's saved config and environment: they decide which skill folders it loads by itself. */
  engineConfig?(instanceId: string): { config?: unknown; environment?: Record<string, string> } | undefined;
  /** The engine instance a bot's new turns run on, for listings made outside a turn. */
  instanceOf?(instanceId: string): TurnInstance | undefined;
}

/** The engine instance a turn runs on. */
type TurnInstance = { instanceId: string; driverKind: string };

type UndoResult =
  | { claimed: true; state: "undone" }
  | { claimed: true; state: "invalid"; error: string; status: number; stale?: true };

export function createSkillsLibraryHost(deps: SkillsLibraryHostDeps) {
  const { store, cfg } = deps;
  const mode = () => shareLearnedSkillsMode(cfg);

  /** The bot's own skills, then every switched-on library skill while the library is on; an imported skill of the same
   * name yields. */
  const ownSkills = (bot: BotRecord) =>
    skillsLibraryEnabled(cfg) ? resolveBotSkills(bot.id, true) : listSkills(bot.id);
  /** What the bot is for, as its settings and its department's shared instructions say: what its skills from this
   * computer are picked by. */
  const aboutBot = (bot: BotRecord): string => {
    const live = store.bot(bot.id) ?? bot;
    return [live.name, live.description, live.soul, live.section, readSectionContext(live.section)?.text].filter(Boolean).join("\n");
  };
  const listBotSkills = (bot: BotRecord, threadId = bot.threadId): SkillListing[] => {
    const own = ownSkills(bot);
    const listed = [...own, ...importedSkillListings(bot.id, new Set(own.map((skill) => skill.name)), aboutBot(bot))];
    const names = new Set(listed.map((skill) => skill.name));
    const natives = nativesFor(bot, threadId).filter((skill) => !names.has(skill.name));
    for (const skill of natives) names.add(skill.name);
    const project = projectFor(bot, threadId).filter((skill) => !names.has(skill.name));
    return [
      ...listed, ...natives.map((skill) => nativeSkillListing(skill, isNativeSkillEnabled(bot.id, skill.name))),
      ...project.map(projectSkillListing),
    ];
  };
  const readBotSkillFile = (bot: BotRecord, name: string): string | null => {
    const own = readSkillFile(bot.id, name);
    if (own !== null) return own;
    // Private wins collisions: a private skill that no longer verifies must not fall through to a same-named library one.
    if (listSkills(bot.id).some((skill) => skill.name === name)) return null;
    if (skillsLibraryEnabled(cfg) && listLibrarySkills().some((skill) => skill.name === name && skill.enabled)) return readLibrarySkillFile(name);
    if (readImportedSkills()[name]) return readImportedSkillFile(name);
    const native = nativesFor(bot).find((skill) => skill.name === name) ?? projectFor(bot, bot.threadId).find((skill) => skill.name === name);
    return native ? readNativeSkillFile(native) : null;
  };
  /** The files beside the SKILL.md readBotSkillFile reads, from the same copy: none for a skill shared from this
   * computer, null when they changed since they came in. */
  const readBotSkillFiles = (bot: BotRecord, name: string): StoredSkillFiles => {
    if (readSkillFile(bot.id, name) !== null) return ownSkillFiles(bot.id, name);
    if (listSkills(bot.id).some((skill) => skill.name === name)) return null;
    if (skillsLibraryEnabled(cfg) && listLibrarySkills().some((skill) => skill.name === name && skill.enabled)) return librarySkillFiles(name);
    return [];
  };

  const shareBotsNow = (): ShareBot[] =>
    store.bots.map((bot) => ({ id: bot.id, name: bot.name, section: bot.section, visibility: bot.visibility }));
  const libraryOn = () => skillsLibraryEnabled(cfg);
  /** The library's switched-on skills, less the names the bot's own skills already answer to. */
  const offersFor = (bot: BotRecord): ImportedSkillView[] =>
    libraryOn() ? offeredSkillViews(new Set(listSkills(bot.id).map((skill) => skill.name))) : [];
  /** The ones of those the bot's prompt lists, every one for the main bot; another bot finds the rest with the tool. */
  const listedOffersFor = (bot: BotRecord, offers: readonly ImportedSkillView[]) => (isMainBot(bot) ? [...offers] : listedOffers(offers, aboutBot(bot)));
  const turnSkillFiles = (bot: BotRecord, instance?: TurnInstance): string[] => {
    const names = resolveBotSkills(bot.id, libraryOn()).filter((skill) => skill.enabled).map((skill) => skill.name);
    return [...new Set([...enabledSkillFiles(bot.id, names, libraryOn()).values(),
      ...listedOffersFor(bot, offersFor(bot)).map((skill) => skill.file),
      ...importsFor(bot, instance).map((skill) => skill.file)])];
  };

  const engineOf = (instance: TurnInstance | undefined): SkillTurnEngine | undefined => {
    if (!instance) return undefined;
    const saved = deps.engineConfig?.(instance.instanceId);
    return {
      driverKind: instance.driverKind,
      ...(saved?.config !== undefined ? { config: saved.config } : {}),
      ...(saved?.environment ? { environment: saved.environment } : {}),
    };
  };
  /** This computer's skills for one turn, less what the turn's engine already loads from the same folder. */
  const importsFor = (bot: BotRecord, instance: TurnInstance | undefined): ImportedSkillView[] =>
    importedSkillsFor(bot.id, new Set([...resolveBotSkills(bot.id, libraryOn()), ...offersFor(bot)].map((skill) => skill.name)),
      nativeSkillFolders(engineOf(instance), { claudeUserSkills: claudeUserSkillsEnabled(cfg) }));
  /** The ones of those the turn's prompt lists and links into its task folder; it searches for the rest. */
  const listedImports = (bot: BotRecord, available: readonly ImportedSkillView[]) => listedImportedSkills(bot.id, available, aboutBot(bot));

  /** The folder a thread's turns run in, as `store.pinTaskCwd` pins it on its first turn: its own task folder for a
   * conversation that keeps a private one, none for a task that already resumes a session, since moving it breaks the
   * resume. */
  const threadFolder = (bot: BotRecord, threadId: string, privateOnly = false): string | null => {
    const task = store.taskByThread(bot.id, threadId);
    if (task?.cwd !== undefined) return task.cwd;
    const own = join(TASK_WORKSPACES_DIR, bot.id, threadId);
    if (privateOnly) return own;
    if (task && Object.keys(task.resumeCursors ?? {}).length > 0) return null;
    return bot.cwd ?? own;
  };
  /** Outside a turn, what the bot's main conversation would load. */
  const nativesFor = (bot: BotRecord, threadId = bot.threadId, instance = deps.instanceOf?.(bot.modelSelection.instanceId), cwd?: string | null) => {
    const engine = engineOf(instance);
    return engine ? nativeSkills(engine, { claudeUserSkills: claudeUserSkillsEnabled(cfg), cwd: cwd === undefined ? threadFolder(bot, threadId) : cwd }) : [];
  };

  /** What the project a turn works in ships for any agent; none for an engine that cannot read files. `cwd` undefined:
   * the thread's own folder. */
  const projectFor = (bot: BotRecord, threadId: string, cwd?: string | null, instance = deps.instanceOf?.(bot.modelSelection.instanceId)): NativeSkill[] => {
    const engine = engineOf(instance);
    if (!engine || !supportsWorkspaceFiles(engine.driverKind)) return [];
    const folder = cwd === undefined ? threadFolder(bot, threadId) : cwd;
    return folder ? projectSkills(engine, { cwd: folder, dataDir: DATA_DIR }) : [];
  };
  /** The project's skills a turn's prompt and `/` menu use, found by themselves as Claude Code finds `.claude/skills`: none
   * of a name the bot already has or its engine loads by itself. */
  const projectInUse = (bot: BotRecord, threadId: string, cwd: string | null | undefined, instance: TurnInstance | undefined): NativeSkill[] => {
    const folder = cwd === undefined ? threadFolder(bot, threadId) : cwd;
    const names = new Set([
      ...resolveBotSkills(bot.id, libraryOn()).map((skill) => skill.name), ...offersFor(bot).map((skill) => skill.name), ...Object.keys(readImportedSkills()),
      ...nativesFor(bot, threadId, instance, folder).map((skill) => skill.name),
    ]);
    return projectFor(bot, threadId, folder, instance).filter((skill) => !names.has(skill.name));
  };

  const editable = (name: string): boolean =>
    mode() !== "off" && sharedSkillEditable(name);

  const harnessListing = (skills: SkillListing[]): Array<SkillListing & { revision?: string }> => {
    if (mode() === "off") return skills;
    return skills.map((skill) => !skill.editable && editable(skill.name)
      ? { ...skill, editable: true, revision: skill.sha256.slice(0, SHARED_REVISION_CHARS) }
      : skill);
  };

  function summaryLine(share: SkillShareRecord): string {
    return share.library === "deduplicated"
      ? "It was already in the skills library, so every bot has it."
      : "It is in the skills library now, so every bot has it.";
  }

  function shareFromBot(
    botId: string,
    name: string,
    receipt?: { threadId: string; messageId: string; expectSha256?: string },
  ): SkillShareRecord | { error: string; stale?: true } {
    const author = shareBotsNow().find((bot) => bot.id === botId);
    if (!author) return { error: "unknown bot" };
    const shared = shareLearnedSkill({
      author, name,
      ...(receipt?.expectSha256 ? { expectSha256: receipt.expectSha256 } : {}),
    });
    if (receipt && !("stale" in shared)) {
      const message = store.messagesFor(receipt.threadId).find((candidate) => candidate.id === receipt.messageId);
      const card = message?.card;
      const request = card?.skillRequest;
      if (card && request) {
        const { shareError: _shareError, ...rest } = request;
        store.patchMessage(receipt.threadId, receipt.messageId, {
          card: { ...card, skillRequest: "error" in shared ? { ...request, shareError: shared.error } : { ...rest, shared } },
        });
      }
    }
    return shared;
  }

  function applySharedUpdate(
    from: BotRecord,
    threadId: string,
    change: { name: string; skillMd: string; gist?: string; expectSha256: string | undefined },
    direct: DirectApply,
  ): { name: string; summary: string; shared: string } | { error: string } {
    if (!change.expectSha256) {
      return { error: `skill "${change.name}" is in the skills library: call the skill tool with its name, then pass the revision skills_list shows as base_revision` };
    }
    const updated = updateSharedLearnedSkill({
      bot: { id: from.id, name: from.name, section: from.section, visibility: from.visibility },
      name: change.name,
      skillMd: change.skillMd,
      expectSha256: change.expectSha256,
    });
    if ("error" in updated) return updated;
    const gist = redactSecretsInText(change.gist ?? "").replace(/\s+/g, " ").trim().slice(0, 240) || updated.description.slice(0, 240);
    const receipt = deps.appendSkillRequestCard({
      botId: from.id,
      threadId,
      applied: true,
      previous: { preview: updated.previous.skillMd, source: updated.previous.source },
      staged: {
        id: randomUUID(),
        action: "update",
        name: change.name,
        gist,
        source: updated.previous.source,
        files: [{ path: "SKILL.md", content: updated.content }],
        sha256: updated.sha256,
        warnings: updated.warnings,
      },
    });
    appendDecision(DATA_DIR, { threadId, requestId: receipt.requestId, botId: from.id, botName: from.name,
      tool: "stage_skill", summary: receipt.summary, decision: "auto-approved", source: direct });
    return { name: change.name, summary: `Skill ${change.name} updated in the skills library.`, shared: "Every bot reads the new version." };
  }

  /** Every skill the bot can read, in the order the index lists them: its own, the library's, the ones from this computer
   * its prompt lists, then the project's. One name once. */
  const indexEntries = (bot: BotRecord, threadId: string, instance: TurnInstance | undefined, cwd: string | null | undefined): { entries: SkillIndexEntry[]; unlisted: number } => {
    const privateNames = new Set(listSkills(bot.id).map((skill) => skill.name));
    const mine = resolveBotSkills(bot.id, false).filter((skill) => skill.enabled);
    // The main bot plans any kind of work, so it sees every library skill; another bot's prompt lists the ones that fit
    // it and reaches the rest with the tool.
    const shelf = libraryOn() ? librarySkillsOnOffer(privateNames) : [];
    const library = isMainBot(bot) ? shelf : listedOffers(shelf, aboutBot(bot));
    const available = importsFor(bot, instance);
    const imports = listedImports(bot, available);
    const project = threadId ? projectInUse(bot, threadId, cwd, instance) : [];
    const entries: SkillIndexEntry[] = [
      ...mine.map((skill) => ({ name: skill.name, description: skill.description, source: "own" as const })),
      ...library.map((skill) => ({ name: skill.name, description: skill.description, source: "library" as const })),
      ...imports.map((skill) => ({ name: skill.name, description: skill.description, source: "computer" as const })),
      ...project.map((skill) => ({ name: skill.name, description: skill.description, source: "project" as const })),
    ];
    return { entries: dedupeSkillEntries(entries), unlisted: (shelf.length - library.length) + (available.length - imports.length) };
  };

  return {
    listBotSkills,
    readBotSkillFile,
    readBotSkillFiles,

    mode,

    /** A turn's skills index, or the preview's without a thread: one line per switched-on skill from every source, within
     * one budget. The full text is not here; the skill tool reads it on demand. */
    skillsIndex(bot: BotRecord, threadId: string | undefined, instance?: TurnInstance, cwd?: string | null): string {
      // A skill whose files changed under review must stop reaching an engine that loads the folder by itself.
      syncSkillLinks(bot.id);
      const { entries, unlisted } = indexEntries(bot, threadId ?? bot.threadId, instance, cwd);
      return renderSkillsIndex(entries, { unlisted });
    },

    /** The skills the model may read, for the skill tool: every switched-on one, whether or not the budget left it out of
     * the prompt. */
    skillCatalogue(bot: BotRecord): Array<{ name: string; description: string }> {
      return listBotSkills(bot).filter((skill) => skill.enabled).map((skill) => ({ name: skill.name, description: skill.description }));
    },

    /** The full SKILL.md of one skill the bot may read, or null for a name it has no switched-on skill under. */
    readSkill(bot: BotRecord, name: string): string | null {
      if (!isSkillName(name)) return null;
      return listBotSkills(bot).some((skill) => skill.name === name && skill.enabled) ? readBotSkillFile(bot, name) : null;
    },

    /** The imported skills a turn links into its task folder: the same ones its index lists, so an engine that loads
     * skill folders by itself sees no more than the prompt does. */
    turnImports(bot: BotRecord, instance?: TurnInstance): ImportedSkillView[] {
      return listedImports(bot, importsFor(bot, instance));
    },

    turnSkillFiles,

    turnSettings(bot: BotRecord, instance: TurnInstance, restrictsMcp: boolean) {
      return {
        ...settingsTurnFields(cfg, DATA_DIR, restrictsMcp),
        ...(instance.driverKind === "antigravityAgent" ? { skillFiles: turnSkillFiles(bot, instance) } : {}),
      };
    },

    /** Each `/name` called for one of the bot's own, library or imported skills, one its engine loads by itself, or one its
     * project ships. `lines` are the turn's own lines when it is a person's turn: only words they typed can call a skill
     * past the start of the text. `privateOnly`: the conversation keeps a private folder, as `store.pinTaskCwd` is told. */
    expandSkillCommand(bot: BotRecord, threadId: string, text: string, instance?: TurnInstance, lines: ReadonlyArray<{ sendId?: string; text?: string }> = [], ownStart = false, privateOnly = false): string {
      const typed = typedWords(threadId, lines);
      const mentioned = skillCalls(text, typed, ownStart);
      if (!mentioned.length) return text;
      const files = enabledSkillFiles(bot.id, mentioned, libraryOn());
      const add = (skills: readonly ImportedSkillView[]) => {
        for (const skill of skills) if (mentioned.includes(skill.name) && !files.has(skill.name)) files.set(skill.name, skill.file);
      };
      if (files.size < mentioned.length) add(offersFor(bot));
      if (files.size < mentioned.length) add(importsFor(bot, instance));
      const engine = files.size < mentioned.length ? engineOf(instance ?? deps.instanceOf?.(bot.modelSelection.instanceId)) : undefined;
      const cwd = engine ? threadFolder(bot, threadId, privateOnly) : null;
      if (files.size < mentioned.length) {
        // A skill switched off on the Skills page stays off, even when the engine holds one of the same name.
        const switched = new Set([...resolveBotSkills(bot.id, libraryOn()), ...importedSkillListings(bot.id, new Set())]
          .filter((skill) => !skill.enabled).map((skill) => skill.name));
        add(nativesFor(bot, threadId, instance, cwd).filter((skill) => !switched.has(skill.name) && isNativeSkillEnabled(bot.id, skill.name)));
      }
      if (files.size < mentioned.length) add(projectInUse(bot, threadId, cwd, instance).filter((skill) => !skill.modelOnly));
      return skillCommandTurnText(text, files, typed, ownStart);
    },

    reviewSkills<T extends { name: string }>(botId: string, own: T[]): Array<T | {
      name: string; description: string; editable: boolean; enabled: boolean; sha256: string; body?: string | null;
    }> {
      if (mode() === "off" || !libraryOn()) return own;
      const ownNames = new Set(own.map((skill) => skill.name));
      const shared = resolveBotSkills(botId, true)
        .filter((skill) => !ownNames.has(skill.name))
        .map((skill) => {
          const canEdit = editable(skill.name);
          return { name: skill.name, description: skill.description, editable: canEdit, enabled: skill.enabled, sha256: skill.sha256,
            ...(canEdit ? { body: readLibrarySkillFile(skill.name) } : {}) };
        });
      return [...own, ...shared];
    },

    sharedSha: (name: string): string | null =>
      editable(name) ? readSkillLibraryIndex()[name]?.sha256 ?? null : null,

    editable,

    applyReviewUpdate(bot: BotRecord, threadId: string, change: { name: string; skillMd: string; gist: string; baseSha256?: string }, direct: DirectApply):
      { ok: true } | { ok: false; error: string } {
      const updated = applySharedUpdate(bot, threadId, {
        name: change.name, skillMd: change.skillMd, gist: change.gist || undefined, expectSha256: change.baseSha256,
      }, direct);
      return "error" in updated ? { ok: false, error: updated.error } : { ok: true };
    },

    harnessUpdate(from: BotRecord, threadId: string, name: string, skillMd: string, gist: unknown, baseRevision: unknown, direct: DirectApply | null):
      [status: number, body: Record<string, unknown>] {
      if (!direct) return [422, { state: "failed", error: "this conversation cannot update a shared team skill" }];
      const updated = applySharedUpdate(from, threadId, {
        name, skillMd, gist: typeof gist === "string" ? gist : undefined, expectSha256: typeof baseRevision === "string" ? baseRevision : undefined,
      }, direct);
      if ("error" in updated) return [422, { state: "failed", error: updated.error }];
      return [201, { state: "applied", name: updated.name, action: "update", summary: updated.summary, shared: updated.shared }];
    },

    /** What skills_list reads: every switched-on skill the bot has, each naming its SKILL.md. */
    harnessSkills(bot: BotRecord): Array<{ name: string; enabled: boolean; editable: boolean; description?: string; listed?: boolean; file?: string; revision?: string }> {
      return harnessListing(listBotSkills(bot)).map((skill) => ({
        ...skill,
        ...(skill.enabled && !skill.editable ? { file: librarySkillFilePath(skill.name) } : {}),
      }));
    },

    harnessListing,

    /** A settlement still pending keeps its stage bound to the private copy, so it waits for the receipt's Share button. */
    afterOwnApply<T extends { settlementPending?: boolean }>(botId: string, threadId: string, staged: { id: string; name: string }, applied: T):
      T & { shared?: string; shareError?: string } {
      if (mode() !== "auto" || applied.settlementPending) return applied;
      const receipt = store.messagesFor(threadId).findLast((message) => message.card?.skillRequest?.stagedId === staged.id);
      const shared = shareFromBot(botId, staged.name, receipt ? { threadId, messageId: receipt.id } : undefined);
      return "error" in shared ? { ...applied, shareError: shared.error } : { ...applied, shared: summaryLine(shared) };
    },

    shareFromReceipt(threadId: string, requestId: string):
      | { ok: true; shared: SkillShareRecord }
      | { ok: false; status: number; error: string } {
      if (mode() === "off") return { ok: false, status: 404, error: "sharing learned skills is not enabled" };
      const message = store.messagesFor(threadId).find((candidate) => candidate.card?.requestId === requestId);
      const card = message?.card;
      const request = card?.skillRequest;
      if (!message || !card || !request) return { ok: false, status: 404, error: "this skill is no longer in the conversation" };
      if (!card.autoApplied || card.answered !== "allow" || card.undone || isSkillSwitchAction(request.action)) {
        return { ok: false, status: 409, error: "only a new or updated skill that applied and was not undone can be shared" };
      }
      if (request.shared) return { ok: true, shared: request.shared };
      const botId = message.from?.botId ?? store.botByThread(threadId)?.id;
      if (!botId || botId !== request.botId) return { ok: false, status: 403, error: "this skill belongs to a different bot" };
      const shared = shareFromBot(botId, request.name, { threadId, messageId: message.id, expectSha256: request.sha256 });
      if ("stale" in shared) return { ok: false, status: 409, error: shared.error };
      return "error" in shared ? { ok: false, status: 422, error: shared.error } : { ok: true, shared };
    },

    shareFromBot,

    undoReceipt(threadId: string, message: Message, request: SkillRequestCardData & { action: "create" | "update"; shared: SkillShareRecord }): UndoResult {
      const undone = undoSharedLearnedSkill({
        name: request.name,
        action: request.action,
        share: request.shared,
        ...(request.previous ? { previous: { skillMd: request.previous.preview, source: request.previous.source } } : {}),
      });
      if ("stale" in undone) return { claimed: true, state: "invalid", error: UNDO_STALE, status: 409, stale: true };
      if ("error" in undone) return { claimed: true, state: "invalid", error: undone.error, status: 409 };
      if (message.card) store.patchMessage(threadId, message.id, { card: { ...message.card, undone: true } });
      return { claimed: true, state: "undone" };
    },
  };
}

export type SkillsLibraryHost = ReturnType<typeof createSkillsLibraryHost>;
