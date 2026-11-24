import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Puzzle, Trash2, Upload } from "lucide-react";

import { PLUGIN_ZIP_MAX_BYTES, type GenerationPluginField, type GenerationPluginSummary, type GenerationPluginValue } from "../../shared/generation-plugins.ts";
import { Switch } from "./SettingsPrimitives";
import { Select } from "./Select";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  deleteGenerationPlugin, installGenerationPlugin, loadGenerationPlugins, pluginFileData, saveGenerationPlugin,
} from "@/lib/generation-plugins";

const NOTE = "text-[12px] leading-4 text-ink-tertiary";
const FIELD = "h-8 w-full rounded-lg border border-hairline/40 bg-inset px-3 text-[13px] leading-[18px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-focus disabled:opacity-50";

/** What a field starts with: a saved value, or the plugin's default, never a secret. */
function initialDraft(plugin: GenerationPluginSummary): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const field of plugin.fields) {
    if (field.type === "secret") continue;
    const value = plugin.values[field.key];
    if (value === undefined) continue;
    draft[field.key] = String(value);
  }
  return draft;
}

function valuesFor(plugin: GenerationPluginSummary, draft: Record<string, string>): Record<string, GenerationPluginValue> {
  const out: Record<string, GenerationPluginValue> = {};
  for (const field of plugin.fields) {
    const typed = draft[field.key];
    if (field.type === "secret") {
      if (typed) out[field.key] = typed;
      continue;
    }
    if (field.type === "boolean") out[field.key] = typed === "true";
    else if (field.type === "number") out[field.key] = typed ?? "";
    else out[field.key] = typed ?? "";
  }
  return out;
}

function kindLabel(kind: "image" | "video"): string {
  return t(kind === "image" ? "generationPlugins.kinds.image" : "generationPlugins.kinds.video");
}

function FieldInput({ field, value, saved, disabled, onChange }: { field: GenerationPluginField; value: string; saved: boolean; disabled: boolean; onChange(value: string): void }) {
  const label = (
    <span className="text-[13px] font-medium leading-[18px] text-ink">
      {field.label}
      {field.required ? <span aria-hidden="true" className="ms-0.5 text-ink-tertiary">*</span> : null}
    </span>
  );
  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3">
        {label}
        <Switch checked={value === "true"} disabled={disabled} aria-label={field.label} onClick={() => onChange(value === "true" ? "false" : "true")} />
      </div>
    );
  }
  const input = field.type === "select" ? (
    <Select value={value} disabled={disabled} aria-label={field.label} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t("generationPlugins.choose")}</option>
      {(field.choices ?? []).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
    </Select>
  ) : (
    <input
      className={FIELD}
      type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
      inputMode={field.type === "number" ? "decimal" : undefined}
      autoComplete={field.type === "secret" ? "new-password" : "off"}
      spellCheck={false}
      dir={field.type === "url" ? "ltr" : undefined}
      value={value}
      disabled={disabled}
      aria-label={field.label}
      placeholder={field.type === "secret" && saved ? t("generationPlugins.secretSaved") : field.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      {label}
      {input}
      {field.help ? <span className={NOTE}>{field.help}</span> : null}
    </div>
  );
}

/** The installed generation plugins: upload, turn on or off, delete, and edit each one's settings in place. */
export function GenerationPluginsPanel({ initialOpenId }: { initialOpenId?: string } = {}) {
  const [plugins, setPlugins] = useState<GenerationPluginSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remember = useCallback((next: GenerationPluginSummary[]) => {
    setPlugins(next);
    setDrafts((current) => Object.fromEntries(next.map((plugin) => [plugin.id, current[plugin.id] ?? initialDraft(plugin)])));
  }, []);

  useEffect(() => {
    let live = true;
    loadGenerationPlugins().then((wire) => live && remember(wire.plugins), (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      live = false;
      if (flash.current) clearTimeout(flash.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [remember]);

  const showSaved = (id: string) => {
    setSavedId(id);
    if (flash.current) clearTimeout(flash.current);
    flash.current = setTimeout(() => setSavedId((current) => (current === id ? null : current)), 4000);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > PLUGIN_ZIP_MAX_BYTES) {
      setError(t("generationPlugins.tooLarge"));
      return;
    }
    setBusy("upload");
    try {
      const wire = await installGenerationPlugin(file.name, await pluginFileData(file));
      remember([...((plugins ?? []).filter((plugin) => plugin.id !== wire.plugin.id)), wire.plugin]);
      setOpenId(wire.plugin.id);
      showSaved(wire.plugin.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const toggle = async (plugin: GenerationPluginSummary, enabled: boolean) => {
    setError(null);
    setBusy(plugin.id);
    try {
      const wire = await saveGenerationPlugin(plugin.id, { enabled });
      remember((plugins ?? []).map((one) => (one.id === plugin.id ? wire.plugin : one)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const save = async (plugin: GenerationPluginSummary) => {
    setError(null);
    setBusy(plugin.id);
    try {
      const wire = await saveGenerationPlugin(plugin.id, { values: valuesFor(plugin, drafts[plugin.id] ?? {}) });
      remember((plugins ?? []).map((one) => (one.id === plugin.id ? wire.plugin : one)));
      setDrafts((current) => ({ ...current, [plugin.id]: initialDraft(wire.plugin) }));
      showSaved(plugin.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const askDelete = (id: string) => {
    if (confirmId === id) {
      void remove(id);
      return;
    }
    setConfirmId(id);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmId((current) => (current === id ? null : current)), 4000);
  };

  const remove = async (id: string) => {
    setError(null);
    setBusy(id);
    try {
      await deleteGenerationPlugin(id);
      remember((plugins ?? []).filter((plugin) => plugin.id !== id));
      setConfirmId(null);
      if (openId === id) setOpenId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section data-generation-plugins="" className="flex flex-col gap-4 pt-1" aria-label={t("generationPlugins.title")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-6 text-ink">{t("generationPlugins.title")}</h3>
          <p className="mt-0.5 max-w-[52ch] text-[13px] leading-[18px] text-ink-secondary">{t("generationPlugins.subtitle")}</p>
        </div>
        <button type="button" data-generation-plugin-upload="" className="ui-button ui-button-sm" disabled={busy === "upload"} onClick={() => input.current?.click()}>
          {busy === "upload" ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Upload size={14} aria-hidden="true" />}
          {t(busy === "upload" ? "generationPlugins.uploading" : "generationPlugins.upload")}
        </button>
        <input ref={input} type="file" accept=".zip,application/zip" className="hidden" aria-label={t("generationPlugins.upload")}
          onChange={(event) => void upload(event.target.files?.[0])} />
      </div>

      {error ? <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[13px] leading-[18px] text-danger">{error}</p> : null}

      {plugins === null && !error ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-ink-secondary">
          <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> {t("generationPlugins.loading")}
        </div>
      ) : null}

      {plugins !== null && plugins.length === 0 ? (
        <div className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-xl border border-hairline/40 px-6 py-8 text-center">
          <Puzzle size={18} aria-hidden="true" className="text-ink-tertiary" />
          <p className="text-[14px] font-medium text-ink">{t("generationPlugins.emptyTitle")}</p>
          <p className="text-[13px] leading-[18px] text-ink-secondary">{t("generationPlugins.emptyBody")}</p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {(plugins ?? []).map((plugin) => {
          const draft = drafts[plugin.id] ?? initialDraft(plugin);
          const open = openId === plugin.id;
          const working = busy === plugin.id;
          const deleteArmed = confirmId === plugin.id;
          return (
            <li key={plugin.id} data-generation-plugin={plugin.id} className="rounded-xl border border-hairline/40">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium leading-[18px] text-ink">{plugin.name}</span>
                    {plugin.version ? <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{plugin.version}</span> : null}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] leading-4 text-ink-secondary">
                    {plugin.problem
                      ? t("generationPlugins.problem", { detail: plugin.problem })
                      : plugin.kinds.length
                        ? plugin.kinds.map(kindLabel).join(" · ")
                        : t("generationPlugins.noModels")}
                    {plugin.problem ? "" : ` · ${t(plugin.configured ? "generationPlugins.ready" : "generationPlugins.needsSetup")}`}
                  </p>
                </div>
                <Switch checked={plugin.enabled} disabled={working || Boolean(plugin.problem)} aria-label={t("generationPlugins.enabledAria", { name: plugin.name })}
                  onClick={() => void toggle(plugin, !plugin.enabled)} />
                <button type="button" className="ui-button ui-button-sm" aria-expanded={open} aria-controls={`generation-plugin-${plugin.id}`}
                  disabled={!plugin.fields.length}
                  onClick={() => setOpenId(open ? null : plugin.id)}>
                  {t("generationPlugins.configure")}
                  <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
                </button>
                <button type="button" data-generation-plugin-delete="" disabled={working}
                  className={cn("inline-flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50",
                    deleteArmed && "bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger")}
                  aria-label={deleteArmed ? t("generationPlugins.deleteConfirm", { name: plugin.name }) : t("generationPlugins.delete", { name: plugin.name })}
                  title={deleteArmed ? t("generationPlugins.deleteAgain") : t("generationPlugins.delete", { name: plugin.name })}
                  onClick={() => askDelete(plugin.id)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
              <div id={`generation-plugin-${plugin.id}`} hidden={!open} className="flex flex-col gap-3 border-t border-hairline/40 px-4 py-3">
                {plugin.fields.map((field) => (
                  <FieldInput key={field.key} field={field} disabled={working} saved={plugin.secrets.includes(field.key)}
                    value={draft[field.key] ?? ""}
                    onChange={(value) => setDrafts((current) => ({ ...current, [plugin.id]: { ...current[plugin.id], [field.key]: value } }))} />
                ))}
                {plugin.fields.some((field) => field.type === "secret") ? (
                  <p className={NOTE}>{t("generationPlugins.secretNote")}</p>
                ) : null}
                <div className="flex items-center justify-end gap-3">
                  <span role="status" aria-live="polite" className="text-[12px] leading-4 text-success">{savedId === plugin.id ? t("generationPlugins.saved") : ""}</span>
                  <button type="button" className="ui-button ui-button-sm ui-button-primary" disabled={working} onClick={() => void save(plugin)}>
                    {working ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
                    {t("generationPlugins.save")}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
