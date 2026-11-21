import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot as BotIcon, FolderInput, LayoutTemplate } from "lucide-react";

import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { newBotOnTeamMap } from "@/state/team-map-focus";
import { ImportDialog, TeamLibraryPanel } from "./lazy-screens";
import type { TeamImportResult } from "./TeamLibraryPanel";

const FEEDBACK_MS = 6_000;

export function teamImportedLine(result: TeamImportResult): string {
  const added = result.members === 0 && result.presets
    ? t("sidebar.presetsImported", { count: result.presets })
    : result.members === 1 ? t("sidebar.teamImportedOne") : t("sidebar.teamImportedMany", { count: result.members });
  return result.connections ? `${added} · ${t("sidebar.connectionsToFinish", { count: result.connections })}` : added;
}

/** What the team map's Add menu makes besides departments and computers: a bot, a team from Templates, an import. */
export function useTeamMapAdd(itemClass: string) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState<"library" | "import" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const returnFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const newBot = <button data-team-map-new-bot="" className={itemClass} onClick={() => dispatch(newBotOnTeamMap(dispatch))}><BotIcon size={14} />{t("sidebar.newBot")}</button>;
  const library = <>
    <button ref={returnFocus} className={itemClass} onClick={() => setOpen("library")}><LayoutTemplate size={14} />{t("sidebar.teamLibrary")}</button>
    <button className={itemClass} onClick={() => setOpen("import")}><FolderInput size={14} />{t("sidebar.import")}</button>
  </>;
  const dialogs = <>
    {open === "library" && <TeamLibraryPanel returnFocusRef={returnFocus} onClose={() => setOpen(null)}
      onImported={(result) => { setOpen(null); setFeedback(teamImportedLine(result)); }} />}
    {open === "import" && <ImportDialog onClose={() => setOpen(null)} onAdded={(line) => { setOpen(null); setFeedback(line); }} />}
    {feedback && createPortal(<div role="status" className="fixed bottom-4 end-4 z-[60] max-w-[320px] rounded-xl border border-hairline/50 bg-card px-3.5 py-2.5 text-[13px] text-ink shadow-xl">{feedback}</div>, document.body)}
  </>;
  return { newBot, library, dialogs };
}
