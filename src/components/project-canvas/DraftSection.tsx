import { useRef, useState } from "react";
import type { ProjectDraftWire } from "../../../shared/project-draft";
import { CommandLine } from "@/components/SettingsPrimitives";
import { t } from "@/lib/i18n";
import { canvasErrorText } from "@/lib/project-canvas/backend";
import { useCanvasUi } from "./canvas-ui";
import { PanelLabel } from "./panel-parts";

const NOTE = "text-[12px] leading-4 text-ink-secondary";

/** Why there is no draft to name, in the person's words. */
function absentText(draft: ProjectDraftWire): string | null {
  if (draft.state === "none") return t("projectCanvas.draft.none");
  if (draft.state !== "unavailable") return null;
  switch (draft.reason) {
    case "remote": return t("projectCanvas.draft.remote");
    case "unsupported-version": return t("projectCanvas.draft.unsupportedVersion");
    default: return t("projectCanvas.draft.notInstalled");
  }
}

/** The post bot's part for the JianYing draft: the draft and the way into JianYing, or why there is none; then the
 * folder the film is exported to and, where the app can tell where a picked file is, choosing the finished film. */
export function DraftSection({ draft }: { draft: ProjectDraftWire }) {
  const ui = useCanvasUi();
  const filmInput = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [filmError, setFilmError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const elsewhere = draft.state === "unavailable" && draft.reason === "remote";
  const written = draft.state === "written" || draft.state === "kept";
  const noJianYing = draft.state === "unavailable" && draft.reason !== "remote" && draft.reason !== "unsupported-version";
  const absent = absentText(draft);
  const name = draft.name ?? "";

  const open = async () => {
    setOpening(true);
    setOpened(null);
    setOpenError(null);
    try {
      const result = await ui.controller.openDraft();
      if (result.opened === "app") setOpened(t("projectCanvas.draft.openedApp", { name }));
    } catch (error) {
      setOpenError(t("projectCanvas.draft.openFailed", { reason: canvasErrorText(error) }));
    } finally {
      setOpening(false);
    }
  };
  const choose = async (file: File) => {
    setAdding(true);
    setFilmError(null);
    try {
      if (!(await ui.controller.chooseFilm(file))) setFilmError(t("projectCanvas.draft.filmOutside"));
    } catch (error) {
      setFilmError(t("projectCanvas.draft.filmFailed", { reason: canvasErrorText(error) }));
    } finally {
      setAdding(false);
    }
  };
  const edit = (
    <button type="button" className="ui-button ui-button-md shrink-0" disabled={!written || opening} onClick={() => void open()}>{t("projectCanvas.draft.edit")}</button>
  );

  return (
    <div data-draft={draft.state} className="flex flex-col gap-2">
      <PanelLabel>{t("projectCanvas.draft.title")}</PanelLabel>
      {written ? (
        <div className="flex items-center gap-2">
          <span data-draft-name="" dir="auto" title={name} className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[18px] text-ink">{name}</span>
          {edit}
        </div>
      ) : noJianYing ? (
        <div className="flex items-center gap-2">
          <p className={`min-w-0 flex-1 ${NOTE}`}>{absent}</p>
          {edit}
        </div>
      ) : (
        <p className={NOTE}>{absent}</p>
      )}
      {draft.state === "kept" ? <p className={NOTE}>{t("projectCanvas.draft.kept")}</p> : null}
      {opened ? <p role="status" className={NOTE}>{opened}</p> : null}
      {openError ? <p role="alert" className="text-[12px] leading-4 text-danger">{openError}</p> : null}
      {elsewhere ? null : (
        <>
          <p className={NOTE}>{t("projectCanvas.draft.exportTo")}</p>
          <CommandLine command={draft.exportFolder} copyLabel={t("projectCanvas.draft.copyFolder")} />
          {ui.controller.picksFiles ? (
            <div className="flex items-center gap-2">
              <button type="button" className="ui-button ui-button-sm shrink-0" disabled={ui.readOnly || adding} onClick={() => filmInput.current?.click()}>{t("projectCanvas.draft.chooseFilm")}</button>
              {filmError ? <span role="alert" className="min-w-0 text-[12px] leading-4 text-danger">{filmError}</span> : null}
              <input
                ref={filmInput}
                type="file"
                accept="video/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void choose(file);
                }}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
