import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Puzzle, Trash2, Upload } from "lucide-react";

import { PLUGIN_ZIP_MAX_BYTES, type GenerationPluginField, type GenerationPluginSummary, type GenerationPluginValue } from "../../shared/generation-plugins.ts";
import { isCleartextRemote } from "../../shared/cleartext-endpoint";
import { SETTINGS_INPUT, SettingsField, SettingsGroup, SettingsMark, SettingsRows, Switch, StatusDot } from "./SettingsPrimitives";
import { Select } from "./Select";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  deleteGenerationPlugin, installGenerationPlugin, loadGenerationPlugins, pluginFileData, saveGenerationPlugin,
} from "@/lib/generation-plugins";

const NOTE = "text-[12px] leading-4 text-ink-tertiary";

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
    <>
      {field.label}
      {field.required ? <span aria-hidden="true" className="ms-0.5 text-ink-tertiary">*</span> : null}
    </>
  );
  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium leading-[18px] text-ink">{label}</span>
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
      className={SETTINGS_INPUT}
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
  const clear = field.type === "url" && isCleartextRemote(value);
  return (
    <SettingsField label={label} hint={field.help || clear ? <>
      {field.help && <span className={NOTE}>{field.help}</span>}
      {clear && <span role="note" className="text-warning">{t("settings.cleartext.endpoint")}</span>}
    </> : undefined}>
      {input}
    </SettingsField>
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
    <section data-generation-plugins="" className="flex flex-col gap-4" aria-label={t("generationPlugins.title")}>
      <SettingsGroup label={t("generationPlugins.section")}
        actions={<>
          <button type="button" data-generation-plugin-upload="" className="ui-button ui-button-sm" disabled={busy === "upload"} onClick={() => input.current?.click()}>
            {busy === "upload" ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Upload size={14} aria-hidden="true" />}
            {t(busy === "upload" ? "generationPlugins.uploading" : "generationPlugins.upload")}
          </button>
          <input ref={input} type="file" accept=".zip,application/zip" className="hidden" aria-label={t("generationPlugins.upload")}
            onChange={(event) => void upload(event.target.files?.[0])} />
        </>}
        description={t("generationPlugins.subtitle")}>

        {error ? <p role="alert" className="rounded-xl bg-danger/10 px-4 py-2 text-[13px] leading-[18px] text-danger">{error}</p> : null}

        <SettingsRows icons>
          {plugins === null && !error ? (
            <div className="flex min-h-11 items-center gap-2 px-4 text-[13px] leading-[18px] text-ink-secondary">
              <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> {t("generationPlugins.loading")}
            </div>
          ) : null}

          {plugins !== null && plugins.length === 0 && !error ? (
            <div className="flex min-h-16 items-center gap-3 px-4 py-3">
              <SettingsMark><Puzzle /></SettingsMark>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] leading-5 text-ink">{t("generationPlugins.emptyTitle")}</span>
                <span className="truncate text-[13px] leading-[18px] text-ink-secondary">{t("generationPlugins.emptyBody")}</span>
              </span>
            </div>
          ) : null}

          {(plugins ?? []).map((plugin) => {
            const draft = drafts[plugin.id] ?? initialDraft(plugin);
            const open = openId === plugin.id;
            const working = busy === plugin.id;
            const deleteArmed = confirmId === plugin.id;
            const state = plugin.problem
              ? { tone: "warning" as const, text: t("generationPlugins.problem", { detail: plugin.problem }) }
              : plugin.configured
                ? { tone: "success" as const, text: t("generationPlugins.ready") }
                : { tone: null, text: t("generationPlugins.needsSetup") };
            const kinds = plugin.kinds.length ? plugin.kinds.map(kindLabel).join(" · ") : t("generationPlugins.noModels");
            return (
              <div key={plugin.id} data-generation-plugin={plugin.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <SettingsMark><Puzzle /></SettingsMark>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[14px] leading-5 text-ink">{plugin.name}</span>
                      {plugin.version ? <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{plugin.version}</span> : null}
                    </span>
                    <span className="truncate text-[13px] leading-[18px] text-ink-secondary">
                      <StatusDot tone={state.tone} />{state.text}{plugin.problem ? "" : ` · ${kinds}`}
                    </span>
                  </span>
                  <Switch checked={plugin.enabled} disabled={working || Boolean(plugin.problem)} aria-label={t("generationPlugins.enabledAria", { name: plugin.name })}
                    onClick={() => void toggle(plugin, !plugin.enabled)} />
                  <button type="button" className="ui-button ml-3 shrink-0" aria-expanded={open} aria-controls={`generation-plugin-${plugin.id}`}
                    disabled={!plugin.fields.length}
                    onClick={() => setOpenId(open ? null : plugin.id)}>
                    {t("generationPlugins.configure")}
                    <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
                  </button>
                  <button type="button" data-generation-plugin-delete="" disabled={working}
                    className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50",
                      deleteArmed && "bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger")}
                    aria-label={deleteArmed ? t("generationPlugins.deleteConfirm", { name: plugin.name }) : t("generationPlugins.delete", { name: plugin.name })}
                    title={deleteArmed ? t("generationPlugins.deleteAgain") : t("generationPlugins.delete", { name: plugin.name })}
                    onClick={() => askDelete(plugin.id)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                <div id={`generation-plugin-${plugin.id}`} hidden={!open} className="flex flex-col gap-3 pb-4 pl-[60px] pr-4 pt-1">
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
                    <button type="button" className="ui-button ui-button-primary" disabled={working} onClick={() => void save(plugin)}>
                      {working ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
                      {t("generationPlugins.save")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </SettingsRows>
      </SettingsGroup>
    </section>
  );
}
