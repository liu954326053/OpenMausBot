// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node-prompt-panel.tsx and
// canvas-reference-bar.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FileText, Music, Plus, RotateCcw, SlidersHorizontal, Video, X } from "lucide-react";
import type { CanvasNode } from "../../../shared/project-canvas";
import type { GenerationKind, GenerationModel, ProjectGenerationSettings, SettingProblem } from "../../../shared/project-generation";
import { MENU_ITEM, MENU_SHEET } from "@/components/menu-recipe";
import { MentionTextarea } from "@/components/MentionTextarea";
import { Select } from "@/components/Select";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { mentionChoicesForQuery, mentionQueryAt } from "@/lib/mentions";
import { connectedReferences, type CanvasReference } from "@/lib/project-canvas/references";
import { overrideSetting, restoreSetting, settingRows, type SettingKey, type SettingRow, type SettingValue } from "@/lib/project-canvas/settings";
import { useCanvasUi } from "./canvas-ui";
import { nodeTypeLabel } from "./node-kinds";

export const PANEL_SURFACE = "popover-surface flex flex-col gap-3 rounded-xl border border-hairline/50 bg-menu p-3";

/** "Image 1": how a prompt names a reference. */
export const referenceLabel = (reference: Pick<CanvasReference, "kind" | "index">) => t("projectCanvas.reference.label", { kind: nodeTypeLabel(reference.kind), index: reference.index });

export function PanelLabel({ children }: { children: ReactNode }) {
  return <div className="text-[12px] font-medium leading-4 text-ink-tertiary">{children}</div>;
}

function ReferenceThumb({ reference, onRemove }: { reference: CanvasReference; onRemove?: () => void }) {
  const ui = useCanvasUi();
  const label = referenceLabel(reference);
  const Icon = reference.kind === "video" ? Video : reference.kind === "audio" ? Music : FileText;
  return (
    <div className="relative flex w-12 flex-col items-center gap-1" title={reference.title || label}>
      <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg border border-hairline bg-inset text-ink-secondary">
        {reference.kind === "image" && reference.file ? (
          <img src={ui.controller.fileUrl(reference.file)} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <Icon size={16} aria-hidden="true" />
        )}
      </div>
      <span className="w-full truncate text-center text-[11px] leading-4 text-ink-secondary">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={t("projectCanvas.reference.remove", { label })}
          title={t("projectCanvas.reference.remove", { label })}
          className="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-hairline bg-menu text-ink-secondary hover:text-ink"
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** The node's inputs, with the "+" that picks more on the canvas. */
export function ReferenceBar({ node, filter }: { node: CanvasNode; filter?: (reference: CanvasReference) => boolean }) {
  const ui = useCanvasUi();
  const references = connectedReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections).filter((reference) => !filter || filter(reference));
  const picking = ui.pickingFor === node.id;
  return (
    <div className="flex flex-col gap-2">
      <PanelLabel>{t("projectCanvas.reference.title")}</PanelLabel>
      <div className="flex flex-wrap items-start gap-2">
        {references.map((reference) => (
          <ReferenceThumb key={`${reference.sourceNodeId}:${reference.nodeId}`} reference={reference} onRemove={ui.readOnly ? undefined : () => ui.removeReference(node.id, reference.sourceNodeId)} />
        ))}
        {!ui.readOnly ? (
          <button
            type="button"
            aria-pressed={picking}
            aria-label={picking ? t("projectCanvas.reference.stopPicking") : t("projectCanvas.reference.add")}
            title={picking ? t("projectCanvas.reference.stopPicking") : t("projectCanvas.reference.add")}
            className={cn("flex size-12 items-center justify-center rounded-lg border border-dashed text-ink-secondary hover:bg-ink/[0.06] active:bg-ink/[0.08]", picking ? "border-accent text-accent-text" : "border-hairline")}
            onClick={() => ui.startPicking(picking ? null : node.id)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {picking ? <p className="text-[12px] leading-4 text-ink-tertiary">{t("projectCanvas.reference.picking")}</p> : null}
    </div>
  );
}

/** A prompt field where "@" names one of `references`. */
export function PromptInput({ value, onChange, references, placeholder, label, onSubmit, disabled }: {
  value: string;
  onChange: (value: string) => void;
  references: readonly CanvasReference[];
  placeholder: string;
  label: string;
  onSubmit?: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const pool = references.map((reference) => ({ name: referenceLabel(reference), reference }));
  const choices = query ? mentionChoicesForQuery(pool, query.query) : [];
  const readQuery = () => {
    const input = inputRef.current;
    setQuery(input ? mentionQueryAt(input.value, input.selectionStart ?? input.value.length) : null);
    setHighlight(0);
  };
  const pick = (name: string) => {
    const input = inputRef.current;
    if (!input || !query) return;
    const caret = input.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${name} ${value.slice(caret)}`;
    onChange(next);
    setQuery(null);
    const at = query.start + name.length + 2;
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(at, at);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (choices.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((index) => (index + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(choices[highlight]?.name ?? choices[0]!.name);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onSubmit) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="relative">
      <MentionTextarea
        inputRef={inputRef}
        peers={pool.map(({ name }) => ({ name }))}
        value={value}
        dir="auto"
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        wrapperClassName="rounded-lg border border-hairline/40 bg-inset focus-within:border-focus"
        className="block min-h-24 w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-[20px] text-ink outline-none placeholder:text-ink-tertiary"
        onChange={(event) => {
          onChange(event.target.value);
          requestAnimationFrame(readQuery);
        }}
        onKeyDown={onKeyDown}
        onClick={readQuery}
        onBlur={() => setQuery(null)}
      />
      {choices.length ? (
        <div role="listbox" aria-label={t("projectCanvas.reference.title")} className={cn(MENU_SHEET, "absolute bottom-full start-0 z-10 mb-1 w-56")}>
          {choices.map((choice, index) => (
            <button
              key={choice.name}
              type="button"
              role="option"
              aria-selected={index === highlight}
              className={cn(MENU_ITEM, index === highlight && "bg-menu-hover")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(choice.name)}
              onPointerEnter={() => setHighlight(index)}
            >
              <span className="truncate">{choice.name}</span>
              <span className="ms-auto truncate text-[12px] text-ink-tertiary">{choice.reference.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function settingLabel(key: SettingKey): string {
  switch (key) {
    case "model": return t("projectCanvas.settings.model");
    case "aspect": return t("projectCanvas.settings.aspect");
    case "quality": return t("projectCanvas.settings.quality");
    case "count": return t("projectCanvas.settings.count");
    case "resolution": return t("projectCanvas.settings.resolution");
    case "seconds": return t("projectCanvas.settings.seconds");
  }
}

export function settingValueLabel(key: SettingKey, value: SettingValue, models?: readonly GenerationModel[] | null): string {
  if (key === "model") return models?.find((model) => model.id === value)?.name ?? (String(value) || t("projectCanvas.settings.noModel"));
  if (key === "seconds") return t("projectCanvas.settings.secondsValue", { count: value });
  if (key === "count") return t("projectCanvas.settings.countValue", { count: value });
  if (key === "quality") {
    switch (value) {
      case "auto": return t("projectCanvas.settings.qualityAuto");
      case "low": return t("projectCanvas.settings.qualityLow");
      case "medium": return t("projectCanvas.settings.qualityMedium");
      case "high": return t("projectCanvas.settings.qualityHigh");
    }
  }
  return String(value);
}

export function problemText(problem: SettingProblem, models?: readonly GenerationModel[] | null): string {
  if (problem.key === "referenceImages") return t("projectCanvas.settings.noReferenceImages");
  if (problem.key === "referenceAudio") return t("projectCanvas.settings.noReferenceAudio");
  if (problem.key === "model") return t("projectCanvas.settings.modelMissing", { model: String(problem.value) || t("projectCanvas.settings.noModel") });
  return t("projectCanvas.settings.notOffered", { setting: settingLabel(problem.key), value: settingValueLabel(problem.key, problem.value, models) });
}

/** One setting: its choices, whether it follows the project, and "restore default" when it does not. */
function SettingField({ row, models, disabled, onChange, onRestore }: { row: SettingRow; models: readonly GenerationModel[] | null; disabled: boolean; onChange: (value: SettingValue) => void; onRestore: () => void }) {
  const choices = row.choices.includes(row.value) ? row.choices : [row.value, ...row.choices];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px] leading-[18px] text-ink">{settingLabel(row.key)}</span>
        {row.overridden ? (
          <button type="button" className="ui-button ui-button-sm" disabled={disabled} onClick={onRestore} title={t("projectCanvas.settings.restoreHint", { value: settingValueLabel(row.key, row.inherited, models) })}>
            <RotateCcw size={14} aria-hidden="true" />
            {t("projectCanvas.settings.restore")}
          </button>
        ) : (
          <span className="text-[12px] leading-4 text-ink-tertiary">{t("projectCanvas.settings.followsProject")}</span>
        )}
      </div>
      <Select
        size="sm"
        aria-label={settingLabel(row.key)}
        value={String(row.value)}
        disabled={disabled}
        onChange={(event) => {
          const picked = choices.find((choice) => String(choice) === event.target.value);
          if (picked !== undefined) onChange(picked);
        }}
      >
        {choices.map((choice) => <option key={String(choice)} value={String(choice)}>{settingValueLabel(row.key, choice, models)}</option>)}
      </Select>
      {row.problem ? <p role="alert" className="text-[12px] leading-4 text-danger">{problemText(row.problem, models)}</p> : null}
    </div>
  );
}

function useNodeSettingRows(node: CanvasNode, kind: GenerationKind, project: ProjectGenerationSettings) {
  const ui = useCanvasUi();
  const models = ui.state.models[kind];
  const rows = settingRows(kind, project, node, models ?? []);
  const change = (key: SettingKey, value: SettingValue) => ui.updateMetadata(node.id, { settings: overrideSetting(node, key, value) });
  const restore = (key: SettingKey) => ui.updateMetadata(node.id, { settings: restoreSetting(node, key) });
  return { rows, models, change, restore };
}

export function ModelPicker({ node, kind, project }: { node: CanvasNode; kind: GenerationKind; project: ProjectGenerationSettings }) {
  const ui = useCanvasUi();
  const { rows, models, change, restore } = useNodeSettingRows(node, kind, project);
  const row = rows.find((candidate) => candidate.key === "model")!;
  const choices = row.choices.includes(row.value) ? row.choices : [row.value, ...row.choices];
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        variant="pill"
        size="sm"
        aria-label={t("projectCanvas.settings.model")}
        className="min-w-0 max-w-48"
        value={String(row.value)}
        disabled={ui.readOnly || !models}
        onChange={(event) => change("model", event.target.value)}
      >
        {choices.map((choice) => <option key={String(choice)} value={String(choice)}>{settingValueLabel("model", choice, models)}</option>)}
      </Select>
      {row.overridden && !ui.readOnly ? (
        <button type="button" className="ui-icon-button" aria-label={t("projectCanvas.settings.restore")} title={t("projectCanvas.settings.restoreHint", { value: settingValueLabel("model", row.inherited, models) })} onClick={() => restore("model")}>
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function SettingsPopover({ node, kind, project }: { node: CanvasNode; kind: GenerationKind; project: ProjectGenerationSettings }) {
  const ui = useCanvasUi();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  const { rows, models, change, restore } = useNodeSettingRows(node, kind, project);
  const shown = rows.filter((row) => row.key !== "model");
  const summary = shown.map((row) => settingValueLabel(row.key, row.value, models)).join(" · ");
  const flagged = shown.some((row) => row.problem);
  return (
    <div ref={rootRef} className="relative min-w-0">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" className={cn("ui-pill max-w-full gap-1.5", flagged && "text-danger")} onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span className="truncate tabular-nums">{summary}</span>
      </button>
      {open ? (
        <div role="dialog" aria-label={t("projectCanvas.settings.title")} className="popover-surface absolute bottom-full start-0 z-20 mb-2 flex w-72 flex-col gap-3 rounded-xl border border-hairline/50 bg-menu p-3">
          {shown.map((row) => (
            <SettingField key={row.key} row={row} models={models} disabled={ui.readOnly} onChange={(value) => change(row.key, value)} onRestore={() => restore(row.key)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
