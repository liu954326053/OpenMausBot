import { t } from "@/lib/i18n";
import type { OptionCardData } from "@/state/store";

/** How a project proposal ended, where the words every proposal shares would mislead. A made project whose request did
 * not reach its lead carries why in `held`. */
export function teamProjectProposalOutcome(card: OptionCardData): string | undefined {
  const proposal = card.teamProjectProposal;
  if (!proposal) return undefined;
  const result = proposal.result;
  if (result?.state === "created") return !card.held && result.leadName ? t("teamProjectProposal.handedOver", { name: result.leadName }) : t("teamProjectProposal.created");
  if (result?.state === "refused") return t("teamProjectProposal.notCreated");
  return card.expired && !result ? t("teamProjectProposal.replaced") : undefined;
}
