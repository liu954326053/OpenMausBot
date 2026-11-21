import type { ComponentProps } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { botModel } from "../BotModelBadge";
import { ELEVATED_FLOAT } from "../elevated";
import { ModelPicker } from "../ModelPicker";
import { InstanceProviderMark } from "../ProviderIcons";
import { useFollowedSource } from "./CopyFollows";

/** A conversation's model picker. A copy's conversations use its source's model: the copy's shows that model, locked, and says why
 * where the picker's label would invite a change. */
export function ConversationModelPicker(props: ComponentProps<typeof ModelPicker>) {
  const { state } = useStore();
  const source = useFollowedSource(props.bot);
  if (!source) return <ModelPicker {...props} />;
  const model = botModel(props.bot, state.instances);
  const label = model?.label ?? props.bot.modelSelection.model;
  const why = t("teamProjects.copy.hint", { source: source.name });
  const whyShown = props.label !== undefined;
  return (
    <span data-copy-conversation-model={source.id} className={cn("flex min-w-0 items-center gap-2", props.className)}>
      {whyShown && <span className="text-[13px] text-ink-secondary">{why}</span>}
      <button type="button" disabled title={`${t("teamProjects.copy.follows", { source: source.name, team: source.team })}\n${why}`} aria-label={whyShown ? label : `${label}. ${why}`}
        className={cn("flex min-w-0 items-center gap-1.5 rounded-full py-1 ps-2 pe-2.5 text-[13px] text-ink-secondary disabled:cursor-not-allowed", !props.contained && ELEVATED_FLOAT)}>
        {model && <InstanceProviderMark instance={model.instance} size={14} subtle />}
        <span className="max-w-[160px] truncate">{label}</span>
        <Lock size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
      </button>
    </span>
  );
}
