import { useEffect, useState, useSyncExternalStore } from "react";

import type { ProjectTeamUnusable } from "../../shared/team-projects";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { TeamMapSection } from "@/lib/team-map";
import { unusableKey } from "@/lib/team-projects";
import { listProjectTeams } from "@/lib/team-projects-api";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { LocaleKey } from "@/locales";
import { ShareDepartmentDialog } from "./lazy-screens";
import { TeamMenuItems } from "./SidebarTeamMenu";
import { TeamSettingsDialog } from "./TeamSettingsDialog";

const NOTE_KEYS: Record<ProjectTeamUnusable, LocaleKey> = {
  empty: "sidebarProjects.mapNote.empty",
  no_chief: "sidebarProjects.mapNote.noChief",
  main_bot_chief: "sidebarProjects.mapNote.mainBotChief",
};

const teamsSignature = (sections: TeamMapSection[]) =>
  sections.map((section) => `${section.key}\n${section.chiefs.map((bot) => bot.id).join(",")}\n${section.members.length}`).join("\n\n");

/** Why each department can't be made into a project, as the server says; nothing for a server without projects. */
export function useProjectTeamNotes(sections: TeamMapSection[]): ReadonlyMap<string, ProjectTeamUnusable> {
  const signature = teamsSignature(sections);
  const [notes, setNotes] = useState<ReadonlyMap<string, ProjectTeamUnusable>>(() => new Map());
  useEffect(() => {
    let current = true;
    listProjectTeams().then(
      (teams) => { if (current) setNotes(new Map(teams.flatMap((team) => team.unusable ? [[team.name, team.unusable] as const] : []))); },
      () => { if (current) setNotes(new Map()); },
    );
    return () => { current = false; };
  }, [signature]);
  return notes;
}

export function TeamMapNote({ reason }: { reason: ProjectTeamUnusable | undefined }) {
  if (!reason) return null;
  return <span data-team-note={reason} title={t(unusableKey(reason))}
    className={cn("min-w-0 shrink truncate rounded-full px-2 py-0.5 text-[10px] font-medium", reason === "empty" ? "bg-control text-ink-secondary" : "bg-warning/10 text-warning")}>
    {t(NOTE_KEYS[reason])}
  </span>;
}

type DepartmentDialog = { kind: "share" | "settings"; department: string };

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

/** The department actions the team map's menu shares with every department menu: Mark all as read, Pause, Set for all, Share. */
export function TeamMapDepartmentItems({ department, itemClass }: { department: string; itemClass: string }) {
  const admin = useOwnerOrAdmin();
  return <TeamMenuItems department={department} itemClass={itemClass} onShare={() => openDialog({ kind: "share", department })}
    onSetForAll={admin === true ? () => openDialog({ kind: "settings", department }) : undefined} />;
}

export function TeamMapDepartmentDialogs() {
  const open = useSyncExternalStore(subscribe, currentDialog, currentDialog);
  useEffect(() => () => openDialog(null), []);
  if (open?.kind === "share") return <ShareDepartmentDialog department={open.department} onClose={() => openDialog(null)} />;
  if (open?.kind === "settings") return <TeamSettingsDialog team={open.department} onClose={() => openDialog(null)} />;
  return null;
}
