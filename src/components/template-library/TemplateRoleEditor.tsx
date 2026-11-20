import { useCallback, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { utf8Bytes } from "@/lib/soul";
import { templatePicture } from "@/lib/template-library";
import { patchedRole, standInBot, type ChangeRole, type RoleDraft } from "@/lib/template-library-draft";
import { api, BotEditorStore, useStore, type Bot, type ModelSelection } from "@/state/store";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import type { TemplateOwnSkill } from "../../../shared/template-library";
import { BotAvatar, HeldAvatarPictures } from "../Avatar";
import { BotProfileAvatarCard } from "../BotProfileAvatarCard";
import { McpServersCard } from "../bot-settings/AccessSection";
import { BotEditorContext } from "../bot-settings/BotEditorContext";
import { Field, inputCls } from "../bot-settings/field";
import { IdentitySection } from "../bot-settings/IdentitySection";
import { ModelSection } from "../bot-settings/ModelSection";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { SoulField } from "../SoulField";
import { RoleSkillsCard } from "./RoleSkillsCard";

async function heldPicture(file: Blob): Promise<string> {
  const picture = await templatePicture(file);
  if (!picture) throw new Error(t("templateLibrary.picture.unusable"));
  return picture;
}

/**
 * One role, edited with the bot editors: they are given a bot that exists on this page only, and a store and a
 * request function that turn what they change and ask into changes to the role.
 */
export function TemplateRoleEditor({ role, skills, nameLimit = BOT_PROFILE_LIMITS.name, change, onRemoveOwnSkill, children }: {
  role: RoleDraft;
  /** The template's own skills, of which the role has those it names. */
  skills: TemplateOwnSkill[];
  nameLimit?: number;
  change: ChangeRole;
  onRemoveOwnSkill: (name: string) => void;
  children?: ReactNode;
}) {
  const parent = useStore();
  const bot = standInBot(role);
  const shown = useRef(bot);
  shown.current = bot;
  const flushBotPatches = useCallback(async () => shown.current, []);
  const store: ReturnType<typeof useStore> = {
    ...parent,
    state: { ...parent.state, bots: [bot, ...parent.state.bots], routines: [], routineRuns: [], routinesLoadState: "ready" },
    flushBotPatches,
    dispatch: (action) => {
      if (action.type === "updateBot" && action.botId === role.id) change((latest) => patchedRole(latest, action.patch));
      else if (action.type === "setModel" && action.botId === role.id) change((latest) => patchedRole(latest, { modelSelection: action.selection }));
      else parent.dispatch(action);
    },
  };
  const request: typeof api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const asked = `${init?.method ?? "GET"} ${path}`;
    const latest = shown.current;
    if (asked === `GET /api/bots/${role.id}/soul`) {
      return { soul: latest.soul ?? "", revision: "draft", bytes: utf8Bytes(latest.soul ?? ""), limit: BOT_PROFILE_LIMITS.soul, file: "", drift: false } as T;
    }
    if (asked === `POST /api/bots/${role.id}/avatar/generate`) {
      const { prompt } = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as { prompt?: string };
      const { name, title, description } = latest;
      const drawn = await api<{ dataUrl: string }>("/api/bot-defaults/avatar", { method: "POST", body: JSON.stringify({ profile: { name, title, description }, prompt }) });
      const avatarUrl = await heldPicture(await (await fetch(drawn.dataUrl)).blob());
      return { avatarUrl, bot: { ...latest, avatarUrl, avatarCrop: "circle" } } as T;
    }
    throw new Error(t("templateLibrary.failed"));
  };

  return (
    <BotEditorStore value={store}>
      <BotEditorContext.Provider value={{ request, draft: true, uploadAvatar: heldPicture }}>
        <HeldAvatarPictures value={true}>
          <RoleFields role={role} bot={bot} skills={skills} nameLimit={nameLimit} change={change} onRemoveOwnSkill={onRemoveOwnSkill} />
          {children}
        </HeldAvatarPictures>
      </BotEditorContext.Provider>
    </BotEditorStore>
  );
}

function RoleFields({ role, bot, skills, nameLimit, change, onRemoveOwnSkill }: {
  role: RoleDraft; bot: Bot; skills: TemplateOwnSkill[]; nameLimit: number; change: ChangeRole; onRemoveOwnSkill: (name: string) => void;
}) {
  const derived = useBotSettingsDerived(bot);
  const [lookOpen, setLookOpen] = useState(false);
  const lookId = useId();
  return (
    <div className="flex flex-col gap-4" data-template-role={role.key ?? ""}>
      <div className="flex items-center gap-3">
        <BotAvatar bot={bot} state={derived.activeState} size={48} animated={false} />
        <div className="min-w-0 flex-1 text-[15px] font-medium text-ink">{t("templateLibrary.role.look")}</div>
        <button type="button" className="ui-button ui-button-md" aria-expanded={lookOpen} aria-controls={lookId} onClick={() => setLookOpen(!lookOpen)}>
          {t(lookOpen ? "common.done" : "templateLibrary.role.look.change")}
        </button>
      </div>
      <div id={lookId} hidden={!lookOpen}>
        {lookOpen && <BotProfileAvatarCard bot={bot} activeState={derived.activeState} mascotMotion={null} onPatch={derived.patch} />}
      </div>
      <Field label={t("botSettings.identity.name")}>
        <input className={inputCls} maxLength={nameLimit} value={role.name} placeholder={t("templateLibrary.role.namePlaceholder")} autoFocus={!role.name} data-template-role-name=""
          onChange={(event) => change((latest) => ({ ...latest, name: event.target.value }))} />
      </Field>
      <IdentitySection bot={bot} patch={derived.patch} activeState={derived.activeState} mascotMotion={null} parts={["title", "blurb"]} />
      <SoulField bot={bot} onPatch={derived.patch} simple={{ label: t("templateLibrary.role.persona"), placeholder: t("bot.soul.placeholder") }} />
      <RoleModel bot={bot} chosen={Boolean(role.model)} change={change} />
      <RoleSkillsCard role={role} own={skills.filter((skill) => role.ownSkills.includes(skill.name))} change={change} onRemoveOwn={onRemoveOwnSkill} />
      <McpServersCard bot={bot} patch={derived.patch} />
      <Field label={t("templateLibrary.role.memory")}>
        <textarea className={cn(inputCls, "min-h-[96px] resize-y leading-relaxed")} value={role.memory} dir="auto" placeholder={t("templateLibrary.role.memoryPlaceholder")}
          onChange={(event) => change((latest) => ({ ...latest, memory: event.target.value }))} />
      </Field>
    </div>
  );
}

/** A role runs on a model of its own, or on the app's default at the time a project is made. */
function RoleModel({ bot, chosen, change }: { bot: Bot; chosen: boolean; change: ChangeRole }) {
  const [asking, setAsking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  if (chosen) {
    return (
      <div className="flex flex-col gap-2">
        <ModelSection bot={bot} />
        <button type="button" className="ui-button ui-button-md self-start" onClick={() => change((latest) => patchedRole(latest, { modelSelection: null }))}>
          {t("templateLibrary.role.model.useDefault")}
        </button>
      </div>
    );
  }
  const choose = async () => {
    setAsking(true);
    setUnavailable(false);
    try {
      const { modelSelection } = await api<{ modelSelection?: ModelSelection }>("/api/bot-defaults");
      if (modelSelection?.instanceId && modelSelection.model) change((latest) => patchedRole(latest, { modelSelection }));
      else setUnavailable(true);
    } catch {
      setUnavailable(true);
    } finally {
      setAsking(false);
    }
  };
  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("model.section.default")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("templateLibrary.role.model.default")}</div>
      <button type="button" className="ui-button ui-button-md mt-3" disabled={asking} onClick={() => void choose()}>{t("templateLibrary.role.model.choose")}</button>
      {unavailable && <p role="alert" className="mt-2 text-[12px] text-danger">{t("templateLibrary.role.model.unavailable")}</p>}
    </div>
  );
}
