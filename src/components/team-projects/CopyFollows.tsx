import type { ReactNode } from "react";
import { SquareStack } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { useTeamProjectSide } from "@/state/team-projects";
import { COPY_FIELDS } from "../../../shared/team-projects";
import { botModel } from "../BotModelBadge";

export interface FollowedSource {
  id: string;
  name: string;
  team: string;
  /** False when the source is not one of the bots this window shows. */
  openable: boolean;
}

/** The bot a copy in a project shows, while it follows one. */
export function useFollowedSource(bot: Pick<Bot, "id" | "name">): FollowedSource | null {
  const side = useTeamProjectSide();
  const { state } = useStore();
  const followed = side.source(bot.id);
  if (!followed) return null;
  const source = state.bots.find((candidate) => candidate.id === followed.sourceId);
  return {
    id: followed.sourceId,
    name: source?.name ?? bot.name,
    team: followed.project.team?.name ?? followed.project.name,
    openable: Boolean(source && !source.hidden),
  };
}

const copyFields: ReadonlySet<string> = new Set(COPY_FIELDS);

/** `patch` without what a copy takes from its source. */
export function withoutCopyFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([field]) => !copyFields.has(field))) as Partial<T>;
}

export function CopyFollowsNotice({ bot, className }: { bot: Pick<Bot, "id" | "name">; className?: string }) {
  const { dispatch } = useStore();
  const source = useFollowedSource(bot);
  if (!source) return null;
  return (
    <div data-copy-follows={source.id} className={cn("flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-3 text-start", className)}>
      <SquareStack size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-[18px] text-ink" title={t("teamProjects.copy.follows", { source: source.name, team: source.team })}>
          {t("teamProjects.copy.follows", { source: source.name, team: source.team })}
        </div>
        <div className="text-[12px] leading-4 text-ink-tertiary">{t("teamProjects.copy.hint", { source: source.name })}</div>
      </div>
      {source.openable && (
        <button
          type="button"
          data-copy-follows-open
          className="ui-button ui-button-sm shrink-0"
          onClick={() => dispatch({ type: "toggleSettings", open: true, botId: source.id })}
        >
          {t("teamProjects.copy.open", { source: source.name })}
        </button>
      )}
    </div>
  );
}

/** The model a copy shows, where its own model picker would be. */
export function FollowedModel({ bot, label, className }: { bot: Bot; label: ReactNode; className?: string }) {
  const { state } = useStore();
  const model = botModel(bot, state.instances);
  return (
    <div data-copy-model className={cn("flex min-w-0 items-center justify-between gap-3", className)}>
      {label}
      {model && <span className="min-w-0 truncate text-[13px] text-ink-secondary">{t("sidebar.bot.modelBadge", { model: model.label, engine: model.instance.displayName })}</span>}
    </div>
  );
}
