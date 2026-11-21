import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Crown, FolderPlus } from "lucide-react";

import { projectTeamUnusable, type ProjectTeamUnusable } from "../../shared/team-projects";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { TeamMapSection } from "@/lib/team-map";
import { unusableKey } from "@/lib/team-projects";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { LocaleKey } from "@/locales";
import { api, useStore, type Bot } from "@/state/store";
import { useTeamProjectSide } from "@/state/team-projects";
import { ChiefPicker } from "./ChiefPicker";
import { ConfirmDialog } from "./ConfirmDialog";
import { ShareDepartmentDialog } from "./lazy-screens";
import { TeamMenuItems } from "./SidebarTeamMenu";
import { TeamSettingsDialog } from "./TeamSettingsDialog";
import { NewTeamProjectDialog } from "./team-projects/NewTeamProjectDialog";

const NOTE_KEYS: Record<ProjectTeamUnusable, LocaleKey> = {
  empty: "sidebarProjects.mapNote.empty",
  no_chief: "sidebarProjects.mapNote.noChief",
  main_bot_chief: "sidebarProjects.mapNote.mainBotChief",
};

/** Why each department can't be made into a project, by the rule the server applies to the bots the map shows; nothing
 * for the bots in no department, or on a server without projects. */
export function useProjectTeamNotes(sections: TeamMapSection<Bot>[]): ReadonlyMap<string, ProjectTeamUnusable> {
  const { shown } = useTeamProjectSide();
  return useMemo(() => new Map(shown ? sections.flatMap((section) => {
    const reason = section.key ? projectTeamUnusable(section.chiefs[0], [...section.chiefs, ...section.members].filter((bot) => !bot.defaultBot).length) : undefined;
    return reason ? [[section.key, reason] as const] : [];
  }) : []), [shown, sections]);
}

type DepartmentDialog =
  | { kind: "share" | "settings" | "newProject"; department: string }
  | { kind: "chief"; department: string; anchor: HTMLElement };

const listeners = new Set<() => void>();
let dialog: DepartmentDialog | null = null;
const openDialog = (next: DepartmentDialog | null) => {
  dialog = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const currentDialog = () => dialog;

/** A department with no Chief of Staff, as the team map's department header says it; a manager presses it to choose one. */
export function TeamMapNote({ department, reason, canChoose }: { department: string; reason: ProjectTeamUnusable | undefined; canChoose: boolean }) {
  const open = useSyncExternalStore(subscribe, currentDialog, currentDialog);
  if (!reason) return null;
  const look = cn("min-w-0 shrink truncate rounded-full px-2 py-0.5 text-[11px] font-medium", reason === "empty" ? "bg-control text-ink-secondary" : "bg-warning/10 text-warning");
  if (reason !== "no_chief" || !canChoose) return <span data-team-note={reason} title={t(unusableKey(reason))} className={look}>{t(NOTE_KEYS[reason])}</span>;
  const picking = open?.kind === "chief" && open.department === department;
  return <button type="button" data-team-note={reason} aria-haspopup="menu" aria-expanded={picking}
    title={t("chiefPicker.hint")} onClick={(event) => openDialog(picking ? null : { kind: "chief", department, anchor: event.currentTarget })}
    className={cn(look, "hover:bg-warning/20 focus-visible:outline-2 focus-visible:outline-accent")}>
    {t(NOTE_KEYS[reason])}
  </button>;
}

/** The department actions the team map's menu shares with every department menu (Mark all as read, Pause, Set for all,
 * Share), after its own: a new project from the team, and the team's Chief of Staff. */
export function TeamMapDepartmentItems({ department, itemClass }: { department: string; itemClass: string }) {
  const admin = useOwnerOrAdmin();
  const { shown } = useTeamProjectSide();
  return <>
    {shown && <button type="button" className={itemClass} onClick={() => openDialog({ kind: "newProject", department })}><FolderPlus size={14} />{t("canvas.newProjectFromTeam")}</button>}
    <button type="button" className={itemClass} aria-haspopup="menu"
      onClick={(event) => openDialog({ kind: "chief", department, anchor: event.currentTarget.closest("details")?.querySelector("summary") ?? event.currentTarget })}>
      <Crown size={14} />{t("chiefPicker.choose")}
    </button>
    <TeamMenuItems department={department} itemClass={itemClass} onShare={() => openDialog({ kind: "share", department })}
      onSetForAll={admin === true ? () => openDialog({ kind: "settings", department }) : undefined} />
  </>;
}

export function TeamMapDepartmentDialogs() {
  const open = useSyncExternalStore(subscribe, currentDialog, currentDialog);
  useEffect(() => () => openDialog(null), []);
  const close = () => openDialog(null);
  if (open?.kind === "share") return <ShareDepartmentDialog department={open.department} onClose={close} />;
  if (open?.kind === "settings") return <TeamSettingsDialog team={open.department} onClose={close} />;
  if (open?.kind === "newProject") return <NewTeamProjectDialog team={open.department} onClose={close} />;
  if (open?.kind === "chief") return <ChiefPicker department={open.department} anchor={open.anchor} onClose={close} />;
  return null;
}

export function DeleteDepartmentDialog({ department, onClose, onError }: { department: string | null; onClose: () => void; onError: (message: string) => void }) {
  const { dispatch } = useStore();
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  return <ConfirmDialog open={department !== null} title={t("team.deleteTitle", { name: department ?? "" })}
    body={t("team.deleteKeepBotsDescription")} confirmLabel={t("team.delete")} pending={pending}
    onCancel={() => { if (!running.current) onClose(); }}
    onConfirm={() => {
      if (department === null || running.current) return;
      running.current = true;
      setPending(true);
      void api<{ sections: string[] }>(`/api/sidebar-sections?section=${encodeURIComponent(department)}`, { method: "DELETE" })
        .then(({ sections }) => { dispatch({ type: "sectionDeleted", section: department, sections }); onClose(); })
        .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => { running.current = false; setPending(false); });
    }} />;
}
