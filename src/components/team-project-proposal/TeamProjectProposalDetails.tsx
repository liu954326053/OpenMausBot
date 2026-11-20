import { useContext } from "react";
import { ChevronRight } from "lucide-react";
import type { TeamProjectProposal } from "../../../shared/team-project-proposal";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBotRow, openThread, StoreContext, type Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";

const LABEL = "text-[12px] font-medium leading-4 text-ink-tertiary";

/** The lead's thread the main bot handed the person's request into: the first one it opened on the lead. */
function handedOverThread(lead: Bot, mainBotId: string): string | undefined {
  return (lead.tasks ?? [])
    .filter((task) => task.openedBy?.botId === mainBotId && task.archivedAt === undefined)
    .sort((a, b) => a.openedBy!.at - b.openedBy!.at)[0]?.threadId;
}

function OpenProject({ leadBotId, mainBotId }: { leadBotId: string; mainBotId: string }) {
  const store = useContext(StoreContext);
  const showThreads = useShowThreads();
  const lead = store?.state.bots.find((bot) => bot.id === leadBotId);
  if (!store || !lead) return null;
  const open = () => {
    const threadId = handedOverThread(lead, mainBotId);
    if (threadId) openThread(store.dispatch, { botId: lead.id, threadId }, store.state, showThreads);
    else openBotRow(store.dispatch, lead, showThreads, false);
  };
  return (
    <button
      type="button"
      data-team-project-open={lead.id}
      onClick={open}
      className="ui-pill mt-3"
    >
      <BotAvatar bot={lead} state="happy" size={16} animated={false} />
      <span className="max-w-[480px] truncate">{t("teamProjectProposal.open")}</span>
      <ChevronRight size={13} aria-hidden="true" className="rtl:-scale-x-100" />
    </button>
  );
}

/** What a proposed project will be, and once it is made the way into it: its lead's chat, on the person's request. */
export function TeamProjectProposalDetails({ proposal }: { proposal: TeamProjectProposal }) {
  const { template, result } = proposal;
  const roles = [...template.roles.filter((role) => role.key === template.lead), ...template.roles.filter((role) => role.key !== template.lead)];
  return (
    <div data-team-project-proposal={proposal.requestId} className="mt-3 text-[13px] leading-[18px]">
      <dl className="grid gap-y-2.5">
        <div>
          <dt className={LABEL}>{t("teamProjectProposal.folder")}</dt>
          <dd className="mt-0.5 break-all font-mono text-ink"><bdi dir="ltr">{proposal.folder}</bdi></dd>
        </div>
        <div>
          <dt className={LABEL}>{t("teamProjectProposal.template")}</dt>
          <dd dir="auto" className="mt-0.5 break-words text-ink">{template.name}</dd>
        </div>
        <div>
          <dt className={LABEL}>{t("teamProjectProposal.members")}</dt>
          <dd className="mt-0.5">
            <ul tabIndex={0} aria-label={t("teamProjectProposal.members")} className="grid max-h-44 gap-y-1 overflow-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {roles.map((role) => (
                <li key={role.key} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span dir="auto" className="min-w-0 break-words font-medium text-ink">
                    {role.key === template.lead ? t("teamProjectProposal.lead", { name: role.name }) : role.name}
                  </span>
                  {role.title && <span dir="auto" className="min-w-0 break-words text-ink-secondary">{role.title}</span>}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      {result?.state === "created" && result.missingSkills.length > 0 && (
        <p dir="auto" className="mt-2.5 break-words text-ink-secondary">{t("teamProjectProposal.missingSkills", { names: result.missingSkills.join(", ") })}</p>
      )}
      {result?.state === "created" && <OpenProject leadBotId={result.leadBotId} mainBotId={proposal.botId} />}
    </div>
  );
}
