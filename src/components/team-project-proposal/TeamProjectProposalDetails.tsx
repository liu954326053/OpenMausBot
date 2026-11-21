import { useContext } from "react";
import { ChevronRight, FolderClosed } from "lucide-react";
import type { TeamProjectProposal } from "../../../shared/team-project-proposal";
import { t } from "@/lib/i18n";
import { StoreContext } from "@/state/store";
import { useTeamProjectSide } from "@/state/team-projects";

const LABEL = "text-[12px] font-medium leading-4 text-ink-tertiary";

interface Member {
  key: string;
  name: string;
  title: string;
  lead: boolean;
}

/** The team a card names and its bots, the lead first; for a card that names a team template instead, the template's roles. */
function teamOf(proposal: TeamProjectProposal): { name: string; members: Member[] } {
  if (proposal.team) {
    const { name, chief, members } = proposal.team;
    return { name, members: members.map((member) => ({ key: member.id, name: member.name, title: member.title, lead: member.id === chief.id })) };
  }
  const template = proposal.template;
  if (!template) return { name: "", members: [] };
  const roles = [...template.roles.filter((role) => role.key === template.lead), ...template.roles.filter((role) => role.key !== template.lead)];
  return { name: template.name, members: roles.map((role) => ({ key: role.key, name: role.name, title: role.title, lead: role.key === template.lead })) };
}

function OpenProject({ projectId }: { projectId: string }) {
  const store = useContext(StoreContext);
  const side = useTeamProjectSide();
  if (!store || (side.shown && !side.projects.some((project) => project.id === projectId))) return null;
  return (
    <button
      type="button"
      data-team-project-open={projectId}
      onClick={() => store.dispatch({ type: "showProject", projectId })}
      className="ui-pill mt-3"
    >
      <FolderClosed size={14} aria-hidden="true" />
      <span className="max-w-[480px] truncate">{t("teamProjectProposal.open")}</span>
      <ChevronRight size={13} aria-hidden="true" className="rtl:-scale-x-100" />
    </button>
  );
}

/** What a proposed project will be, and once it is made the way into it: its canvas. */
export function TeamProjectProposalDetails({ proposal }: { proposal: TeamProjectProposal }) {
  const { result } = proposal;
  const team = teamOf(proposal);
  return (
    <div data-team-project-proposal={proposal.requestId} className="mt-3 text-[13px] leading-[18px]">
      <dl className="grid gap-y-2.5">
        <div>
          <dt className={LABEL}>{t("teamProjectProposal.folder")}</dt>
          <dd className="mt-0.5 break-all font-mono text-ink"><bdi dir="ltr">{proposal.folder}</bdi></dd>
        </div>
        <div>
          <dt className={LABEL}>{t("teamProjectProposal.team")}</dt>
          <dd dir="auto" className="mt-0.5 break-words text-ink">{team.name}</dd>
        </div>
        <div>
          <dt className={LABEL}>{t("teamProjectProposal.members")}</dt>
          <dd className="mt-0.5">
            <ul tabIndex={0} aria-label={t("teamProjectProposal.members")} className="grid max-h-44 gap-y-1 overflow-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {team.members.map((member) => (
                <li key={member.key} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span dir="auto" className="min-w-0 break-words font-medium text-ink">
                    {member.lead ? t("teamProjectProposal.lead", { name: member.name }) : member.name}
                  </span>
                  {member.title && <span dir="auto" className="min-w-0 break-words text-ink-secondary">{member.title}</span>}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      {result?.state === "created" && <OpenProject projectId={result.projectId} />}
    </div>
  );
}
