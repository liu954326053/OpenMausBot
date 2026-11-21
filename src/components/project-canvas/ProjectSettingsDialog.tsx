import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import {
  COMMON_CHOICES,
  modelOffers,
  type GenerationFailure,
  type GenerationKind,
  type GenerationModel,
  type ProjectGenerationSettings,
} from "../../../shared/project-generation";
import { Select } from "@/components/Select";
import { Segmented } from "@/components/SettingsPrimitives";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t, tFromServer } from "@/lib/i18n";
import { SETTING_KEYS, type SettingKey, type SettingValue } from "@/lib/project-canvas/settings";
import { useCanvasUi } from "./canvas-ui";
import { problemText, settingValueLabel } from "./panel-parts";

const LABEL = "text-[13px] font-medium leading-[18px] text-ink";
const NOTE = "text-[12px] leading-4 text-ink-tertiary";

function defaultChoices(kind: GenerationKind, key: SettingKey, model: GenerationModel | undefined): SettingValue[] {
  const offers = model ? modelOffers(model) : null;
  if (kind === "image") {
    const image = offers?.kind === "image" ? offers : { aspects: [...COMMON_CHOICES.image.aspects], qualities: [...COMMON_CHOICES.image.qualities], counts: Array.from({ length: COMMON_CHOICES.image.maxCount }, (_, index) => index + 1) };
    return key === "aspect" ? image.aspects : key === "quality" ? image.qualities : key === "count" ? image.counts : [];
  }
  const video = offers?.kind === "video" ? offers : { resolutions: [...COMMON_CHOICES.video.resolutions], aspects: [...COMMON_CHOICES.video.aspects], durations: [...COMMON_CHOICES.video.durations] };
  return key === "resolution" ? video.resolutions : key === "aspect" ? video.aspects : key === "seconds" ? video.durations : [];
}

function settingName(key: SettingKey): string {
  switch (key) {
    case "model": return t("projectCanvas.settings.defaultModel");
    case "aspect": return t("projectCanvas.settings.aspect");
    case "quality": return t("projectCanvas.settings.quality");
    case "count": return t("projectCanvas.settings.count");
    case "resolution": return t("projectCanvas.settings.resolution");
    case "seconds": return t("projectCanvas.settings.seconds");
  }
}

/** The project's generation settings: per kind, the MCP server, the default model and what a node that overrides nothing uses. */
export function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const ui = useCanvasUi();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog(dialogRef, onClose);
  const saved = ui.state.generation;
  const [draft, setDraft] = useState<ProjectGenerationSettings | null>(() => (saved ? structuredClone(saved.settings) : null));
  const [kind, setKind] = useState<GenerationKind>("video");
  const [models, setModels] = useState<GenerationModel[] | null>(null);
  const [modelsRefused, setModelsRefused] = useState<GenerationFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<GenerationFailure | null>(null);
  const server = draft?.[kind].server ?? null;

  useEffect(() => {
    if (!server) {
      setModels(null);
      setModelsRefused(null);
      return;
    }
    let live = true;
    setModels(null);
    setModelsRefused(null);
    ui.controller.previewModels(kind, server).then((result) => {
      if (!live) return;
      if ("refused" in result) setModelsRefused(result.refused);
      else setModels(result.models);
    }, (error: unknown) => live && setModelsRefused({ code: "unreachable", error: error instanceof Error ? error.message : String(error), errorKey: "" }));
    return () => {
      live = false;
    };
  }, [kind, server, ui.controller]);

  const changeServer = (next: string | null) => {
    setRefusal(null);
    setDraft((current) => (current ? { ...current, [kind]: { ...current[kind], server: next } } : current));
  };
  const changeDefault = (key: SettingKey, value: SettingValue) => {
    setRefusal(null);
    setDraft((current) => {
      if (!current) return current;
      return kind === "image"
        ? { ...current, image: { ...current.image, defaults: { ...current.image.defaults, [key]: value } } }
        : { ...current, video: { ...current.video, defaults: { ...current.video.defaults, [key]: value } } };
    });
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const refused = await ui.controller.saveGeneration(draft).catch((error: unknown) => ({ code: "unreachable" as const, error: error instanceof Error ? error.message : String(error), errorKey: "" }));
    setBusy(false);
    if (refused) setRefusal(refused);
    else onClose();
  };

  const defaults = draft?.[kind].defaults as unknown as Record<string, SettingValue> | undefined;
  const model = models?.find((candidate) => candidate.id === defaults?.model);
  const servers = saved?.servers ?? [];

  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-project-canvas-settings=""
        className="ui-modal flex max-h-full w-full max-w-[480px] flex-col text-ink outline-none animate-pop-in motion-reduce:animate-none">
        <header className="flex flex-col gap-3 px-5 pb-2 pt-5">
          <h2 id={titleId} className="truncate text-[20px] font-semibold leading-7 tracking-[-0.01em]">{t("projectCanvas.settings.projectTitle")}</h2>
          <Segmented label={t("projectCanvas.settings.kind")} value={kind} onChange={(next) => { setKind(next); setRefusal(null); }}
            options={[{ value: "image", label: t("projectCanvas.nodeType.image") }, { value: "video", label: t("projectCanvas.nodeType.video") }]} />
        </header>
        {!draft ? (
          <p className="px-5 pb-4 text-[13px] leading-[18px] text-ink-secondary">{t("projectCanvas.settings.unavailable")}</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
            <div className="flex flex-col gap-1">
              <span className={LABEL}>{t("projectCanvas.settings.server")}</span>
              <Select aria-label={t("projectCanvas.settings.server")} value={server ?? ""} disabled={ui.readOnly} onChange={(event) => changeServer(event.target.value || null)}>
                <option value="">{t("projectCanvas.settings.noServer")}</option>
                {servers.map((name) => <option key={name} value={name}>{name}</option>)}
              </Select>
              <span className={NOTE}>{t("projectCanvas.settings.serverNote")}</span>
            </div>
            {server && !models && !modelsRefused ? <LoaderCircle size={16} aria-label={t("projectCanvas.loading")} className="animate-spin text-ink-tertiary motion-reduce:animate-none" /> : null}
            {modelsRefused ? <p role="alert" className="text-[12px] leading-4 text-danger">{tFromServer(modelsRefused.errorKey, modelsRefused.error, modelsRefused.errorParams)}</p> : null}
            {defaults ? SETTING_KEYS[kind].map((key) => {
              const value = defaults[key]!;
              const choices = key === "model" ? (models ?? []).map((candidate) => candidate.id) : defaultChoices(kind, key, model);
              const listed = choices.includes(value) || (key === "model" && value === "") ? choices : [value, ...choices];
              return (
                <div key={key} className="flex flex-col gap-1">
                  <span className={LABEL}>{settingName(key)}</span>
                  <Select aria-label={settingName(key)} value={String(value)} disabled={ui.readOnly || (key === "model" && !models)} onChange={(event) => {
                    const picked = key === "model" ? event.target.value : listed.find((choice) => String(choice) === event.target.value);
                    if (picked !== undefined) changeDefault(key, picked);
                  }}>
                    {key === "model" ? <option value="">{t("projectCanvas.settings.noModel")}</option> : null}
                    {listed.map((choice) => <option key={String(choice)} value={String(choice)}>{settingValueLabel(key, choice, models)}</option>)}
                  </Select>
                </div>
              );
            }) : null}
            <p className={NOTE}>{t("projectCanvas.settings.inheritNote")}</p>
            {refusal ? (
              <div role="alert" className="flex flex-col gap-1 text-[12px] leading-4 text-danger">
                <span>{tFromServer(refusal.errorKey, refusal.error, refusal.errorParams)}</span>
                {refusal.problems?.map((problem) => <span key={problem.key}>{problemText(problem, models)}</span>)}
              </div>
            ) : null}
          </div>
        )}
        <footer className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5">
          <button type="button" className="ui-button ui-button-md" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={busy || !draft || ui.readOnly} onClick={() => void save()}>
            {busy ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
            {t("projectCanvas.settings.save")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
