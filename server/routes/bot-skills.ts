import { z } from "zod";

import { SKILL_UPLOAD_LIMITS } from "../../shared/skill-import.ts";
import type { SkillsLibrarySkillWire } from "../../shared/wire.ts";
import type { AppConfig } from "../config.ts";
import { setImportedSkillEnabled } from "../imported-skills.ts";
import { setNativeSkillEnabled } from "../native-skill-choices.ts";
import { botSkillTemplateSchema } from "../new-bot-defaults.ts";
import { readSkillArchive } from "../skill-archive.ts";
import { fetchSkillFromSource } from "../skill-fetch.ts";
import { skillImportSummary } from "../skill-folder.ts";
import {
  installLibrarySkill, librarySkillOnOffer, listLibrarySkills, readLibrarySkillFile, readSkillLibraryIndex, removeLibrarySkill, restoreLibrarySkill,
  setLibrarySkillReviewState, skillsLibraryEnabled,
} from "../skill-library.ts";
import { installUploadedSkills, skillFoldersIn, UPLOAD_MAX_SKILLS, type UploadedFile } from "../skill-upload.ts";
import {
  installSkill, listBotSkillsWithOrigin, listSkills, listStagedSkillWrites, parseSkillMd, removeSkill, scanSkillText, setSkillEnabled,
  type SkillListing, type StagedSkillWrite,
} from "../skills.ts";
import type { BotRecord, Store } from "../store.ts";
import { userError } from "../user-errors.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** The upload as base64 inside JSON, which is a third larger than its bytes, with room for the paths. */
const UPLOAD_BODY_MAX = Math.ceil(SKILL_UPLOAD_LIMITS.bytes * 4 / 3) + 4 * 1024 * 1024;
const uploadPath = z.string().min(1).max(1024);
const uploadSchema = z.object({
  archive: z.string().min(1).optional(),
  files: z.array(z.object({ path: uploadPath, content: z.string() })).min(1).max(SKILL_UPLOAD_LIMITS.files).optional(),
  /** Files of the folder that were too large to send. */
  oversize: z.array(uploadPath).max(SKILL_UPLOAD_LIMITS.files).optional(),
  /** The file or folder the person chose, shown as where the skill came from. */
  label: z.string().max(200).optional(),
  replace: z.array(z.string().min(1).max(64)).max(UPLOAD_MAX_SKILLS).optional(),
}).refine((body) => (body.archive !== undefined) !== (body.files !== undefined));

const uploadSource = (label: string | undefined) =>
  `upload:${Array.from(label ?? "", (char) => (char < " " || char === "\u007f" ? " " : char)).join("").replace(/\s+/g, " ").trim().slice(0, 80) || "files"}`;

export interface BotSkillsRouteDeps {
  store: Store;
  cfg: AppConfig;
  listBotSkills(bot: BotRecord, threadId?: string): SkillListing[];
  readBotSkillFile(bot: BotRecord, name: string): string | null;
  stagedSkillListing(staged: StagedSkillWrite): Omit<StagedSkillWrite, "files" | "baseSha256" | "baseAppliedStageId">;
}

export function createBotSkillsRoutes(deps: BotSkillsRouteDeps): RouteHandler {
  const { store, cfg, listBotSkills, readBotSkillFile, stagedSkillListing } = deps;
  return async ({ req, res, url, path, method, json, readBody }) => {
    let m: RegExpMatchArray | null = null;
    // Imports land DISABLED: a person enables one after reading SKILL.md and its scan warnings.
    m = path.match(/^\/api\/bots\/([\w-]+)\/skill-template$/);
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const checked = botSkillTemplateSchema.safeParse(await readBody(req));
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const input = checked.data;
      const parsed = parseSkillMd(input.text);
      if ("error" in parsed || parsed.name !== input.name) return json(res, 400, { error: "Skill name does not match its contents" });
      const installed = installSkill(m[1], input.source, [{ path: "SKILL.md", content: input.text }]);
      if ("error" in installed) return json(res, 422, { error: installed.error });
      if (input.enabled) {
        const enabled = setSkillEnabled(m[1], input.name, true);
        if ("error" in enabled) return json(res, 422, { error: enabled.error });
      }
      return json(res, 201, { installed });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/skills$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // The thread names a folder on disk: only one of this bot's own threads may pick it.
      const asked = url.searchParams.get("threadId");
      const threadId = asked && store.taskByThread(bot.id, asked) ? asked : bot.threadId;
      const { skills } = { skills: listBotSkillsWithOrigin(m[1]!) };
      const names = new Set(skills.map((skill) => skill.name));
      return json(res, 200, {
        skills: [...skills, ...listBotSkills(bot, threadId).filter((skill) => !names.has(skill.name))],
        staged: listStagedSkillWrites(m[1]).map(stagedSkillListing),
      });
    }
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ source: z.string().min(1).max(2000) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "source must be a GitHub or skills.sh URL, or owner/repo" });
      const fetched = await fetchSkillFromSource(parsed.data.source);
      if ("error" in fetched) return json(res, 422, { error: fetched.error });
      const results = fetched.skills.map((skill) => ({ skill, result: installSkill(m![1]!, skill.source, skill.files, skill.github) }));
      const errors = results.flatMap(({ result }) => ("error" in result ? [result.error] : []));
      const done = results.flatMap(({ skill, result }) => ("error" in result ? [] : [{ skill, installed: result }]));
      if (!done.length) return json(res, 422, { error: errors.join("; ") || "nothing importable found" });
      const imported = done.map(({ skill, installed }) => skillImportSummary(installed.name, skill.files, skill.skipped));
      return json(res, 201, { installed: done.map(({ installed }) => installed), imported, errors });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      const text = bot ? readBotSkillFile(bot, m[2]!) : null;
      if (text === null) return json(res, 404, { error: "no such skill" });
      return json(res, 200, { text });
    }
    if (m && method === "PATCH") {
      const parsed = z.object({ enabled: z.boolean() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "enabled must be true or false" });
      const bot = store.bot(m[1]);
      // A skill from this computer that none of the bot's own or library skills shadows: this bot's switch for it.
      if (bot && listBotSkills(bot).some((skill) => skill.name === m![2] && (skill as { origin?: string }).origin === "imported")) {
        const result = setImportedSkillEnabled(bot.id, m[2]!, parsed.data.enabled);
        if ("error" in result) return json(res, 409, { error: result.error });
        return json(res, 200, { skill: result });
      }
      if (bot && listBotSkills(bot).some((skill) => skill.name === m![2] && "origin" in skill && skill.origin === "native")) {
        const result = setNativeSkillEnabled(bot.id, m[2]!, parsed.data.enabled);
        if ("error" in result) return json(res, 409, { error: result.error });
        const skill = listBotSkills(bot).find((entry) => entry.name === m![2]);
        if (!skill) return json(res, 404, { error: "no such skill" });
        return json(res, 200, { skill });
      }
      const result = setSkillEnabled(m[1]!, m[2]!, parsed.data.enabled);
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, { skill: result });
    }
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]!);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const name = m[2]!;
      const removed = removeSkill(bot.id, name);
      if (!("error" in removed)) return json(res, 200, { ok: true });
      if (listSkills(bot.id).some((skill) => skill.name === name)) return json(res, 409, { error: removed.error });
      const origin = (listBotSkills(bot).find((skill) => skill.name === name) as { origin?: string } | undefined)?.origin;
      if (origin === "library") return json(res, 404, { error: `"${name}" is in the skills library, which every bot shares. Turn it off or remove it there.` });
      if (origin === "imported") return json(res, 404, { error: `"${name}" comes from this computer and can't be removed from one bot. Turn it off instead.` });
      if (origin === "native") return json(res, 404, { error: `"${name}" comes from this bot's engine and can't be removed here.` });
      return json(res, 404, { error: removed.error });
    }

    m = path.match(/^\/api\/skills-library$/);
    if (m && method === "GET") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const skills: SkillsLibrarySkillWire[] = listLibrarySkills()
        .map((listing): SkillsLibrarySkillWire => {
          const index = readSkillLibraryIndex();
          return {
            name: listing.name,
            description: listing.description,
            source: listing.source,
            enabled: listing.enabled,
            tags: listing.tags ?? [],
            version: index[listing.name]?.package?.release ?? null,
            importedAt: listing.importedAt,
            ...(listing.license ? { license: listing.license } : {}),
            ...(listing.compatibility ? { compatibility: listing.compatibility } : {}),
            warnings: listing.warnings,
            ...(librarySkillOnOffer(listing) ? { onOffer: true } : {}),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, { skills });
    }
    if (m && method === "POST") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ text: z.string().min(1) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "text must be the SKILL.md contents to import" });
      const skill = parseSkillMd(parsed.data.text);
      if ("error" in skill) return json(res, 400, { error: skill.error });
      const installed = installLibrarySkill({
        name: skill.name,
        instructions: parsed.data.text,
        source: "local-import",
        license: skill.license,
        compatibility: skill.compatibility,
        tags: skill.tags,
        warnings: scanSkillText(parsed.data.text),
        reviewState: "disabled",
      });
      if ("error" in installed) return json(res, 422, { error: installed.error });
      return json(res, 201, { skill: installed });
    }
    if (path === "/api/skills-library/upload" && method === "POST") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = uploadSchema.safeParse(await readBody(req, UPLOAD_BODY_MAX));
      if (!parsed.success) return json(res, 400, { error: "send a zip archive or a folder's files that hold a SKILL.md" });
      let files: UploadedFile[];
      let oversize = parsed.data.oversize ?? [];
      if (parsed.data.archive !== undefined) {
        const read = await readSkillArchive(Buffer.from(parsed.data.archive, "base64"));
        if ("error" in read) return json(res, 422, read);
        ({ files, oversize } = read);
      } else {
        files = parsed.data.files!.map((file) => ({ path: file.path.replace(/\\/g, "/"), content: Buffer.from(file.content, "base64") }));
      }
      if (!skillFoldersIn(files).length) return json(res, 422, userError("serverError.skillUpload.noSkill"));
      const result = installUploadedSkills(files, { source: uploadSource(parsed.data.label), replace: new Set(parsed.data.replace ?? []), oversize });
      if (result.installed.length) return json(res, 201, result);
      if (result.conflicts.length) return json(res, 409, { ...result, error: `already in the library: ${result.conflicts.join(", ")}` });
      if (result.unchanged.length) return json(res, 200, result);
      return json(res, 422, { ...result, error: result.errors.join("; ") || "nothing importable found" });
    }
    if (path === "/api/skills-library/restore" && method === "POST") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ undo: z.string().min(1).max(200) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "undo must name what was removed" });
      const restored = restoreLibrarySkill(parsed.data.undo);
      if ("error" in restored) return json(res, 409, { error: restored.error });
      return json(res, 200, { skill: restored });
    }
    m = path.match(/^\/api\/skills-library\/([a-z0-9-]+)$/);
    if (m && method === "DELETE") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const removed = removeLibrarySkill(m[1]!);
      if ("error" in removed) return json(res, 404, { error: removed.error });
      return json(res, 200, { ok: true, undo: removed.undo });
    }
    if (m && method === "GET") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const text = readLibrarySkillFile(m[1]!);
      if (text === null) return json(res, 404, { error: "no such skill" });
      return json(res, 200, { text });
    }
    if (m && method === "PATCH") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ enabled: z.boolean() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "enabled must be true or false" });
      const result = setLibrarySkillReviewState(m[1]!, parsed.data.enabled ? "approved" : "disabled");
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, { skill: result });
    }
    return PASS;
  };
}
