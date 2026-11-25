import { useEffect, useRef } from "react";

import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { SkillsSection } from "./SkillsSection";
import { TOOL_PAGE_TITLE, ToolPage, ToolPageHeader } from "./ToolPageShell";

/** The skills every bot shares: add a package, read a skill, switch it on. */
export function SkillsLibraryPage() {
  const { dispatch } = useStore();
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  return (
    <ToolPage label={t("skills.library.title")}>
      <ToolPageHeader backLabel={t("automations.back")} onBack={() => dispatch({ type: "showChat" })} backRef={back}>
        <h1 className={TOOL_PAGE_TITLE}>{t("skills.library.title")}</h1>
      </ToolPageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" data-skills-library-page="">
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          <SkillsSection />
        </div>
      </div>
    </ToolPage>
  );
}
