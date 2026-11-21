import type { Bot } from "@/state/store";
import { SoulField } from "../SoulField";
import { ProposalStatus } from "./ProposalStatus";
import { ReplyStyleField } from "./ReplyStyleField";
import type { BotPatch } from "./useBotSettingsDerived";
import { t } from "@/lib/i18n";

export function SoulSection({ bot, patch, readOnly = false }: { bot: Bot; patch: (patch: BotPatch) => void; readOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-secondary">
        {t("botSettings.soul.description")}
      </p>
      <ProposalStatus bot={bot} kind="chief" />
      <SoulField bot={bot} onPatch={patch} readOnly={readOnly} />
      <ReplyStyleField bot={bot} patch={patch} />
    </div>
  );
}
