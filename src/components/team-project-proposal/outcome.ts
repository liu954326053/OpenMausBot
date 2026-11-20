import { t } from "@/lib/i18n";
import type { OptionCardData } from "@/state/store";

/** How a project proposal ended, where the words every proposal shares would mislead. */
export function teamProjectProposalOutcome(card: OptionCardData): string | undefined {
  const proposal = card.teamProjectProposal;
  if (!proposal) return undefined;
  if (proposal.result?.state === "created") return t("teamProjectProposal.created");
  if (proposal.result?.state === "refused") return t("teamProjectProposal.notCreated");
  return card.expired && !proposal.result ? t("teamProjectProposal.replaced") : undefined;
}
