import { LayoutTemplate, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { MENU_ITEM } from "../menu-recipe";
import { openSaveBackToTemplate, openUpdateFromTemplate } from "./host";

const ITEM = cn(MENU_ITEM, "hover:bg-menu-hover [&>svg]:text-ink-secondary");

/**
 * The two template actions in a project's menu. Only the owner or an admin is offered them, as the server lets nobody
 * else run them, and only while the project's folder is there. `onChoose` closes the menu.
 */
export function TemplateSyncMenuItems({ project, onChoose }: { project: TeamProjectWire; onChoose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  const offered = useOwnerOrAdmin() === true && project.folderState === "ready";
  useEffect(() => { if (offered) first.current?.focus(); }, [offered]);
  if (!offered) return null;
  const choose = (open: () => void) => () => { onChoose(); open(); };
  return (
    <>
      <button ref={first} type="button" role="menuitem" data-template-sync-update="" className={ITEM}
        onClick={choose(() => openUpdateFromTemplate(project.id, project.name))}>
        <RefreshCw size={16} aria-hidden="true" />{t("templateSync.menu.update")}
      </button>
      <button type="button" role="menuitem" data-template-sync-save-back="" className={ITEM}
        onClick={choose(() => openSaveBackToTemplate(project.id, { projectName: project.name, templateName: project.template.name }))}>
        <LayoutTemplate size={16} aria-hidden="true" />{t("templateSync.menu.saveBack")}
      </button>
    </>
  );
}
