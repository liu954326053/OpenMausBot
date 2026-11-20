import { FileArchive, FolderOpen, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import type { SkillUploadResult } from "../../shared/skill-import";
import { t } from "@/lib/i18n";
import { archiveUpload, folderUpload, sendSkillUpload, skillNames, skillUploadLines, skillUploadRefusalText, type SkillUpload, type SkillUploadRefusal } from "@/lib/skill-upload";
import { Card } from "./SettingsPrimitives";

/** Adds the skills of a .zip or .skill file, or of a folder, to the skills library. `onAdded` runs once any came in. */
export function SkillPackageUpload({ disabled, onAdded }: { disabled: boolean; onAdded: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<{ upload: SkillUpload; result: SkillUploadResult } | null>(null);

  /** `earlier`: what the first send of this package came to, when this one replaces the skills it left alone. */
  const send = async (upload: SkillUpload, earlier?: SkillUploadResult) => {
    setBusy(true);
    setError("");
    try {
      const result = await sendSkillUpload(upload, earlier?.conflicts);
      // The same package sent again: the skills the first send brought in come back as unchanged.
      setReport({ upload, result: earlier ? { ...result, installed: [...earlier.installed, ...result.installed], unchanged: earlier.unchanged } : result });
      if (result.installed.length) onAdded();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("skills.upload.failed"));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (read: () => Promise<SkillUpload | SkillUploadRefusal>) => {
    setBusy(true);
    setError("");
    setReport(null);
    let upload: SkillUpload | SkillUploadRefusal;
    try {
      upload = await read();
    } catch {
      setBusy(false);
      setError(t("skills.upload.failed"));
      return;
    }
    if (typeof upload === "string") {
      setBusy(false);
      setError(skillUploadRefusalText(upload));
      return;
    }
    await send(upload);
  };

  const off = disabled || busy;
  const lines = report ? skillUploadLines(report.result) : [];
  return (
    <Card title={t("skills.upload.title")} subtitle={t("skills.upload.hint")}>
      <div className="flex flex-col gap-3" data-skill-upload={busy ? "busy" : "ready"}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="ui-button" disabled={off} onClick={() => fileInput.current?.click()}>
            {busy ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <FileArchive size={14} aria-hidden="true" />}
            {busy ? t("skills.upload.adding") : t("skills.upload.chooseFile")}
          </button>
          <button type="button" className="ui-button" disabled={off} onClick={() => folderInput.current?.click()}>
            <FolderOpen size={14} aria-hidden="true" />
            {t("skills.upload.chooseFolder")}
          </button>
          <input ref={fileInput} type="file" hidden accept=".zip,.skill,application/zip" data-skill-upload-file onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void choose(() => archiveUpload(file));
          }} />
          <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "" }} data-skill-upload-folder onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length) void choose(() => folderUpload(files));
          }} />
        </div>
        {lines.length > 0 && (
          <div role="status" className="flex flex-col gap-1 text-[13px] leading-[18px] text-ink-secondary">
            {lines.map((line) => <p key={line} dir="auto">{line}</p>)}
          </div>
        )}
        {report && report.result.conflicts.length > 0 && (
          <div role="status" className="flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5">
            <p dir="auto" className="text-[13px] leading-[18px] text-ink">{t("skills.upload.conflict", { names: skillNames(report.result.conflicts) })}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ui-button ui-button-md" disabled={off} onClick={() => void send(report.upload, report.result)}>{t("skills.upload.replace")}</button>
              <button type="button" className="ui-button ui-button-md" disabled={off} onClick={() => setReport({ ...report, result: { ...report.result, conflicts: [] } })}>{t("skills.upload.keep")}</button>
            </div>
          </div>
        )}
        {error && <p role="alert" dir="auto" className="text-[13px] leading-[18px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
