import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { generationKindOf } from "../../../shared/project-canvas";
import { PRODUCTION_CONCURRENCY_MAX } from "../../../shared/production";
import {
  COMMON_CHOICES,
  fitSettings,
  modelOffers,
  type GenerationFailure,
  type GenerationKind,
  type GenerationKindSettings,
  type GenerationModel,
  type ImageSettings,
  type ProjectGenerationSettings,
  type SettingProblem,
  type VideoSettings,
} from "../../../shared/project-generation";
import { Select } from "@/components/Select";
import { Segmented } from "@/components/SettingsPrimitives";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { activeLocale, t, tFromServer } from "@/lib/i18n";
import {
  CONCURRENCY_KEYS,
  concurrencyCount,
  SETTING_KEYS,
  withConcurrency,
  type ConcurrencyKey,
  type SettingKey,
  type SettingValue,
} from "@/lib/project-canvas/settings";
import type { LocaleKey } from "@/locales";
import { nodeById, useCanvasUi } from "./canvas-ui";
import { problemText, settingValueLabel } from "./panel-parts";

const LABEL = "text-[13px] font-medium leading-[18px] text-ink";
const NOTE = "text-[12px] leading-4 text-ink-tertiary";
const PROBLEM = "text-[12px] leading-4 text-danger";
const COUNT_FIELD = "h-8 w-20 shrink-0 rounded-lg border border-hairline/40 bg-inset px-3 text-end text-[13px] leading-[18px] tabular-nums text-ink disabled:opacity-50 aria-[invalid=true]:border-danger";

const COUNT_NAMES = {
  videos: "projectSettings.videos",
  images: "projectSettings.images",
  episodes: "projectSettings.episodes",
} as const satisfies Record<ConcurrencyKey, LocaleKey>;

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

function withDefaults(settings: ProjectGenerationSettings, kind: GenerationKind, defaults: ImageSettings | VideoSettings): ProjectGenerationSettings {
  return kind === "image"
    ? { ...settings, image: { ...settings.image, defaults: defaults as ImageSettings } }
    : { ...settings, video: { ...settings.video, defaults: defaults as VideoSettings } };
}

/** `kind`'s defaults fitted to their model when `models` lists it, and with no model when it does not. */
function fittedTo(settings: ProjectGenerationSettings, kind: GenerationKind, models: readonly GenerationModel[]): ProjectGenerationSettings {
  const defaults = settings[kind].defaults;
  if (!defaults.model) return settings;
  const model = models.find((candidate) => candidate.id === defaults.model);
  return withDefaults(settings, kind, model ? fitSettings(kind, defaults, model) : { ...defaults, model: "" });
}

const anyOf = (labels: string[]) => new Intl.ListFormat(activeLocale(), { type: "disjunction" }).format(labels);

/** A setting a save was refused for: its field and what to choose instead. */
function refusedText(problem: SettingProblem, settings: GenerationKindSettings<ImageSettings | VideoSettings>, models: readonly GenerationModel[] | null): string {
  const { key } = problem;
  if (key === "referenceImages" || key === "referenceAudio") return problemText(problem, models);
  const setting = settingName(key);
  const choices = anyOf(problem.offered.map((choice) => settingValueLabel(key, choice, models)));
  if (key === "model") {
    const server = settings.server ?? "";
    return problem.offered.length
      ? t("projectCanvas.settings.refusedModel", { setting, server, value: String(problem.value), choices })
      : t("projectCanvas.settings.refusedNoModels", { setting, server });
  }
  return t("projectCanvas.settings.refusedChoice", { setting, model: settingValueLabel("model", settings.defaults.model, models), value: settingValueLabel(key, problem.value, models), choices });
}

/** The project's generation settings: per kind, the MCP server, the default model and what a node that overrides nothing
 * uses; and how many videos, images and episodes its production runs at once. */
export function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const ui = useCanvasUi();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog(dialogRef, onClose);
  const saved = ui.state.generation;
  const [draft, setDraft] = useState<ProjectGenerationSettings | null>(() => (saved ? withConcurrency(structuredClone(saved.settings)) : null));
  const [typedCounts, setTypedCounts] = useState<Partial<Record<ConcurrencyKey, string>>>({});
  const [flaggedCounts, setFlaggedCounts] = useState<ReadonlySet<ConcurrencyKey>>(() => new Set());
  const countsId = useId();
  const [kind, setKind] = useState<GenerationKind>(() => {
    const opener = ui.panelNodeId ? nodeById(ui.snapshot, ui.panelNodeId) : undefined;
    return (opener && generationKindOf(opener)) || "image";
  });
  const [models, setModels] = useState<GenerationModel[] | null>(null);
  const [modelsRefused, setModelsRefused] = useState<GenerationFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<GenerationFailure | null>(null);
  const plugin = draft?.[kind].plugin ?? null;
  const server = plugin ? null : (draft?.[kind].server ?? null);

  useEffect(() => {
    if (!plugin && !server) {
      setModels(null);
      setModelsRefused(null);
      return;
    }
    let live = true;
    setModels(null);
    setModelsRefused(null);
    ui.controller.previewModels(kind, plugin ? { plugin } : { server: server! }).then((result) => {
      if (!live) return;
      if ("refused" in result) {
        setModelsRefused(result.refused);
        return;
      }
      setModels(result.models);
      setDraft((current) => (current ? fittedTo(current, kind, result.models) : current));
    }, (error: unknown) => live && setModelsRefused({ code: "unreachable", error: error instanceof Error ? error.message : String(error), errorKey: "" }));
    return () => {
      live = false;
    };
  }, [kind, plugin, server, ui.controller]);

  const changePlugin = (next: string | null) => {
    setRefusal(null);
    setDraft((current) => (current ? {
      ...current,
      [kind]: {
        ...current[kind],
        plugin: next,
        ...(next ? { server: null } : {}),
        defaults: { ...current[kind].defaults, model: "" } as ImageSettings | VideoSettings,
      },
    } : current));
  };
  const changeServer = (next: string | null) => {
    setRefusal(null);
    setDraft((current) => (current ? { ...current, [kind]: { ...current[kind], server: next, ...(next ? { plugin: null } : {}) } } : current));
  };
  const changeDefault = (key: SettingKey, value: SettingValue) => {
    setRefusal(null);
    setDraft((current) => {
      if (!current) return current;
      const defaults = { ...current[kind].defaults, [key]: value } as ImageSettings | VideoSettings;
      const model = key === "model" ? models?.find((candidate) => candidate.id === value) : undefined;
      return withDefaults(current, kind, model ? fitSettings(kind, defaults, model) : defaults);
    });
  };
  const holdsNoCount = (key: ConcurrencyKey) => {
    const typed = typedCounts[key];
    return typed !== undefined && concurrencyCount(typed) === null;
  };
  const flagCounts = (keys: readonly ConcurrencyKey[]) => setFlaggedCounts((current) => new Set([...current, ...keys]));
  const changeCount = (key: ConcurrencyKey, typed: string) => {
    setRefusal(null);
    setTypedCounts((current) => ({ ...current, [key]: typed }));
    const count = concurrencyCount(typed);
    if (count === null) return;
    setFlaggedCounts((current) => new Set([...current].filter((flagged) => flagged !== key)));
    setDraft((current) => (current ? { ...current, concurrency: { ...current.concurrency, [key]: count } } : current));
  };
  const save = async () => {
    if (!draft) return;
    const noCounts = CONCURRENCY_KEYS.filter(holdsNoCount);
    if (noCounts.length) {
      flagCounts(noCounts);
      document.getElementById(`${countsId}-${noCounts[0]}`)?.focus();
      return;
    }
    setBusy(true);
    const refused = await ui.controller.saveGeneration(draft).catch((error: unknown) => ({ code: "unreachable" as const, error: error instanceof Error ? error.message : String(error), errorKey: "" }));
    setBusy(false);
    if (refused) setRefusal(refused);
    else onClose();
  };

  const defaults = draft?.[kind].defaults as unknown as Record<string, SettingValue> | undefined;
  const model = models?.find((candidate) => candidate.id === defaults?.model);
  const servers = saved?.servers ?? [];
  const plugins = (saved?.plugins ?? []).filter((one) => !one.problem && one.kinds.includes(kind));
  const loadingModels = Boolean(plugin || server) && !models && !modelsRefused;
  const refusalLines = !refusal || !draft ? [] : [...new Set(refusal.problems?.length
    ? refusal.problems.map((problem) => refusedText(problem, draft[kind], models))
    : [tFromServer(refusal.errorKey, refusal.error, refusal.errorParams)])];
  const modelsText = modelsRefused ? tFromServer(modelsRefused.errorKey, modelsRefused.error, modelsRefused.errorParams) : null;

  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
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
              <span className={LABEL}>{t("projectCanvas.settings.plugin")}</span>
              <Select aria-label={t("projectCanvas.settings.plugin")} value={plugin ?? ""} disabled={ui.readOnly} onChange={(event) => changePlugin(event.target.value || null)}>
                <option value="">{t("projectCanvas.settings.noPlugin")}</option>
                {plugins.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
              </Select>
              <span className={NOTE}>{t("projectCanvas.settings.pluginNote")}</span>
            </div>
            {plugin ? null : (
              <div className="flex flex-col gap-1">
                <span className={LABEL}>{t("projectCanvas.settings.server")}</span>
                <Select aria-label={t("projectCanvas.settings.server")} value={server ?? ""} disabled={ui.readOnly} onChange={(event) => changeServer(event.target.value || null)}>
                  <option value="">{t("projectCanvas.settings.noServer")}</option>
                  {servers.map((name) => <option key={name} value={name}>{name}</option>)}
                </Select>
                <span className={NOTE}>{t("projectCanvas.settings.serverNote")}</span>
              </div>
            )}
            {loadingModels ? <LoaderCircle size={16} aria-label={t("projectCanvas.loading")} className="animate-spin text-ink-tertiary motion-reduce:animate-none" /> : null}
            {modelsText && !refusalLines.includes(modelsText) ? <p role="alert" className={PROBLEM}>{modelsText}</p> : null}
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
            <div role="group" aria-labelledby={`${countsId}-name`} data-project-settings-counts="" className="flex flex-col gap-2 border-t border-hairline/40 pt-4">
              <span id={`${countsId}-name`} className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("projectSettings.production")}</span>
              {CONCURRENCY_KEYS.map((key) => {
                const id = `${countsId}-${key}`;
                const flagged = flaggedCounts.has(key);
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <label htmlFor={id} className={cn(LABEL, "min-w-0 flex-1")}>{t(COUNT_NAMES[key])}</label>
                      <input id={id} type="number" inputMode="numeric" min={1} max={PRODUCTION_CONCURRENCY_MAX} step={1}
                        value={typedCounts[key] ?? String(draft.concurrency[key])} disabled={ui.readOnly}
                        aria-invalid={flagged || undefined} aria-describedby={flagged ? `${id}-problem` : undefined}
                        onChange={(event) => changeCount(key, event.target.value)}
                        onBlur={() => { if (holdsNoCount(key)) flagCounts([key]); }}
                        className={COUNT_FIELD} />
                    </div>
                    {flagged ? (
                      <p id={`${id}-problem`} role="alert" className={PROBLEM}>
                        {t("projectSettings.range", { setting: t(COUNT_NAMES[key]), max: PRODUCTION_CONCURRENCY_MAX })}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {refusalLines.length ? (
              <div role="alert" className={cn("flex flex-col gap-1", PROBLEM)}>
                {refusalLines.map((line) => <span key={line}>{line}</span>)}
              </div>
            ) : null}
          </div>
        )}
        <footer className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5">
          <button type="button" className="ui-button ui-button-md" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={busy || !draft || ui.readOnly || loadingModels} onClick={() => void save()}>
            {busy ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
            {t("projectCanvas.settings.save")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
