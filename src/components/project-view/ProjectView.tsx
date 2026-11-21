import { Crown, FolderClosed, FolderX, Loader2, MessagesSquare } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { BotAvatar } from "@/components/Avatar";
import { useCaptionChrome, WindowDragStrip } from "@/components/DesktopCapabilities";
import { sidebarBotStatus } from "@/components/SidebarBotActivity";
import { botShowsUnread } from "@/lib/bot-unread";
import { cn } from "@/lib/cn";
import { useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { teamMapBotCount } from "@/lib/team-map";
import { useShowThreads } from "@/lib/thread-preferences";
import type { Bot, Group } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { useTeamProjectSide } from "@/state/team-projects";
import { landingBot, openBot } from "@/state/thread-navigation";

export interface ProjectViewProps {
  projectId: string;
  /** The member the person chose in the sidebar; none when they opened the project itself. */
  selectedBotId?: string;
}

type MemberStatus = { text: string; tone: string };

function memberStatus(bot: Bot, queued: Record<string, unknown[]>): MemberStatus | null {
  const { waiting, working, failed, teammateWait, queued: inQueue } = sidebarBotStatus(bot, queued);
  if (waiting) return { text: t("chat.handoff.waitingOnYou"), tone: "text-warning" };
  if (working) return { text: t("chat.activity.working"), tone: "text-success" };
  if (failed) return { text: t("sidebar.preview.failed"), tone: "text-danger" };
  if (botShowsUnread(bot)) return { text: t("task.unread"), tone: "text-accent-text" };
  if (teammateWait) return { text: t("sidebar.preview.waitingOnTeammate"), tone: "text-ink-secondary" };
  return inQueue ? { text: t("task.queued"), tone: "text-ink-secondary" } : null;
}

/** A project: its lead and members, each with what it is doing and a way into its chat, and its own group chats. */
export function ProjectView({ projectId, selectedBotId }: ProjectViewProps) {
  const dispatch = useStoreDispatch();
  const bots = useStoreSelector((state) => state.bots);
  const groups = useStoreSelector((state) => state.groups);
  const queued = useStoreSelector((state) => state.pendingQueued);
  const side = useTeamProjectSide();
  const viewer = useViewerEmail();
  const showThreads = useShowThreads();
  const { dragProps } = useCaptionChrome();
  const project = side.projects.find((one) => one.id === projectId);
  const gone = side.shown && !project;
  const chosen = useRef<HTMLLIElement>(null);
  const landed = useRef(false);

  useEffect(() => {
    if (!gone) { landed.current = false; return; }
    if (landed.current) return;
    landed.current = true;
    const home = landingBot(bots, viewer);
    if (home) openBot(dispatch, home, showThreads);
  }, [gone, bots, viewer, dispatch, showThreads]);
  useEffect(() => { chosen.current?.scrollIntoView?.({ block: "nearest" }); }, [selectedBotId, project?.id]);

  if (!project) {
    return (
      <main data-project-loading="" className="relative flex min-w-0 flex-1 items-center justify-center bg-app text-ink-secondary">
        <WindowDragStrip />
        <Loader2 size={20} role="status" aria-label={t("projectView.loading")} className="animate-spin" />
      </main>
    );
  }

  const team = side.team(project, bots.filter((bot) => !bot.hidden));
  const rooms = side.teamRooms(project, groups);
  return (
    <main data-project-view={project.id} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <header {...dragProps} className="flex shrink-0 flex-col gap-1 border-b border-hairline/40 px-6 py-4 max-md:ps-12">
        <div className="flex items-center gap-2.5">
          <FolderClosed size={18} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <h1 className="min-w-0 truncate text-[17px] font-semibold">{project.name}</h1>
          <span className="ms-1 shrink-0 text-[11px] text-ink-secondary">{teamMapBotCount(team.length)}</span>
        </div>
        <ProjectFolder project={project} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
          <ProjectList title={t("teamProjects.team")}>
            {team.map((bot) => {
              const selected = bot.id === selectedBotId;
              const status = memberStatus(bot, queued);
              return (
                <li key={bot.id} ref={selected ? chosen : undefined} data-project-member={bot.id} aria-current={selected ? "true" : undefined}
                  className={cn("flex items-center gap-3 px-3 py-2.5", selected && "bg-raised")}>
                  <button type="button" data-choose-member="" onClick={() => dispatch({ type: "showProject", projectId: project.id, botId: bot.id })}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-start focus-visible:outline-2 focus-visible:outline-focus">
                    <BotAvatar bot={bot} size={36} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium leading-5">
                        <span className="truncate">{bot.name}</span>
                        {bot.id === project.leadBotId && (
                          <span className="flex shrink-0 items-center gap-1 text-[12px] font-normal text-ink-secondary">
                            <Crown size={12} aria-hidden="true" className="text-warning" />{t("sidebar.bot.chiefOfStaff")}
                          </span>
                        )}
                      </span>
                      {bot.title && <span className="truncate text-[12px] leading-4 text-ink-secondary">{bot.title}</span>}
                    </span>
                  </button>
                  {status && <span data-member-status="" className={cn("shrink-0 text-[12px]", status.tone)}>{status.text}</span>}
                  <OpenChat label={t("canvas.openBotChat", { name: bot.name })} onOpen={() => openBot(dispatch, bot, showThreads)} />
                </li>
              );
            })}
          </ProjectList>
          {rooms.length > 0 && (
            <ProjectList title={t("sidebar.section.channels")}>
              {rooms.map((group) => <ProjectRoom key={group.id} group={group} onOpen={() => dispatch({ type: "select", id: group.id })} />)}
            </ProjectList>
          )}
        </div>
      </div>
    </main>
  );
}

function ProjectFolder({ project }: { project: TeamProjectWire }) {
  if (project.folderState === "missing") {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-warning">
        <FolderX size={14} aria-hidden="true" className="shrink-0" />{t("teamProjects.folderMissing")}
      </p>
    );
  }
  return <p dir="ltr" title={project.folder} className="truncate text-start text-[12px] text-ink-secondary">{project.folder}</p>;
}

function ProjectList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-ink-secondary">{title}</h2>
      <ul className="divide-y divide-hairline/40 overflow-hidden rounded-xl border border-hairline/60 bg-panel">{children}</ul>
    </section>
  );
}

function ProjectRoom({ group, onOpen }: { group: Group; onOpen: () => void }) {
  return (
    <li data-project-room={group.id} className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-control text-ink-secondary">
        <MessagesSquare size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{group.name}</span>
      {group.unread && <span data-member-status="" className="shrink-0 text-[12px] text-accent-text">{t("task.unread")}</span>}
      <OpenChat label={t("canvas.openBotChat", { name: group.name })} onOpen={onOpen} />
    </li>
  );
}

function OpenChat({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button type="button" data-open-chat="" aria-label={label} onClick={onOpen}
      className="shrink-0 rounded-lg border border-hairline/60 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-control focus-visible:outline-2 focus-visible:outline-focus">
      {t("canvas.openChat")}
    </button>
  );
}
