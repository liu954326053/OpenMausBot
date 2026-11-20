import { AVATAR_MAX_BYTES } from "../../shared/package-format";
import type {
  BotTemplateInput, BotTemplateWire, TeamTemplateInput, TeamTemplateWire, TemplateKind, TemplateLibraryWire,
} from "../../shared/template-library";
import { api, ApiError } from "@/state/api";
import { t } from "./i18n";
import { prepareBanner, type BannerTools } from "./place-banner";

const ROOT = "/api/template-library";
const PATH: Record<TemplateKind, string> = { bot: `${ROOT}/bots`, team: `${ROOT}/teams` };
const one = (kind: TemplateKind, id: string) => `${PATH[kind]}/${encodeURIComponent(id)}`;
const sent = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

/** A refused request in the app's own sentence, which says what to do next; anything else as a plain line. */
export const templateFailure = (cause: unknown): string => (cause instanceof ApiError ? cause.message : t("templateLibrary.failed"));

export const listTemplates = (): Promise<TemplateLibraryWire> => api<TemplateLibraryWire>(ROOT);

export const readBotTemplate = async (id: string): Promise<BotTemplateWire> => (await api<{ template: BotTemplateWire }>(one("bot", id))).template;
export const readTeamTemplate = async (id: string): Promise<TeamTemplateWire> => (await api<{ template: TeamTemplateWire }>(one("team", id))).template;

/** Makes the template, or with `id` saves that one as its next version. */
export async function saveBotTemplate(input: BotTemplateInput, id?: string): Promise<BotTemplateWire> {
  return (await api<{ template: BotTemplateWire }>(id ? one("bot", id) : PATH.bot, sent(id ? "PUT" : "POST", input))).template;
}

export async function saveTeamTemplate(input: TeamTemplateInput, id?: string): Promise<TeamTemplateWire> {
  return (await api<{ template: TeamTemplateWire }>(id ? one("team", id) : PATH.team, sent(id ? "PUT" : "POST", input))).template;
}

/** Takes the template out of the library. The answer names it for `restoreTemplate`. */
export const removeTemplate = async (kind: TemplateKind, id: string): Promise<string> =>
  (await api<{ undo: string }>(one(kind, id), { method: "DELETE" })).undo;

export const restoreTemplate = async (undo: string): Promise<void> => { await api(`${ROOT}/restore`, sent("POST", { undo })); };

export const saveBotAsTemplate = async (botId: string): Promise<BotTemplateWire> =>
  (await api<{ template: BotTemplateWire }>(`${PATH.bot}/from-bot`, sent("POST", { botId }))).template;

export const saveDepartmentAsTemplate = async (department: string): Promise<TeamTemplateWire> =>
  (await api<{ template: TeamTemplateWire }>(`${PATH.team}/from-department`, sent("POST", { department }))).template;

/** A role's picture is shown small, and the template folder format holds 64 KB of it and no GIF. */
const PICTURE_LIMITS = { side: 512, bytes: AVATAR_MAX_BYTES, stillGif: true };

const dataUrl = (blob: Blob): Promise<string | null> => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(blob);
});

/** The chosen file as a template keeps a role's picture: redrawn small, as a `data:` URL. Null: it can't be used. */
export async function templatePicture(file: Blob, tools?: BannerTools): Promise<string | null> {
  const prepared = await prepareBanner(file, tools, PICTURE_LIMITS);
  return prepared.ok ? dataUrl(prepared.blob) : null;
}
