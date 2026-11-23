import { ExternalLink, Film, Scissors } from "lucide-react";
import { episodeCode } from "../../../../shared/production";
import type { ProjectDraftWire } from "../../../../shared/project-draft";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardAction, CardLabel, CardName, CardShell, clockLength, InlineVideo, PicturePlaceholder, shotCode } from "./parts";

/** One of the episode's shots, in the order the film plays. */
export interface FinalClip {
  number: number;
  state: "ready" | "generating" | "failed" | "missing";
  durationMs?: number;
}

export interface FinalCardProps {
  episode: number;
  /** The episode's title. */
  title: string;
  coverUrl?: string;
  videoUrl?: string;
  durationMs?: number;
  clips: readonly FinalClip[];
  draft?: ProjectDraftWire;
  onOpen?: () => void;
  onPlay?: () => void;
  onOpenDraft?: () => void;
}

const CLIP_LOOK: Readonly<Record<FinalClip["state"], string>> = {
  ready: "bg-success/25 text-ink",
  generating: "bg-accent/20 text-ink-secondary",
  failed: "bg-danger/20 text-danger",
  missing: "border border-dashed border-ink-tertiary/60 text-ink-tertiary",
};
const UNTIMED_CLIP_MS = 5000;

function draftText(draft: ProjectDraftWire): string {
  switch (draft.state) {
    case "written": return draft.name ?? "";
    case "kept": return t("boardCards.draft.kept", { name: draft.name ?? "" });
    case "none": return t("boardCards.draft.none");
    case "unavailable":
      return draft.reason === "remote" ? t("boardCards.draft.remote")
        : draft.reason === "unsupported-version" ? t("boardCards.draft.unsupportedVersion")
        : t("boardCards.draft.notInstalled");
  }
}

export function FinalCard({ episode, title, coverUrl, videoUrl, durationMs, clips, draft, onOpen, onPlay, onOpenDraft }: FinalCardProps) {
  const name = t("boardCards.final.title", { episode: episodeCode(episode) });
  const ready = clips.filter((clip) => clip.state === "ready").length;
  const opens = draft && (draft.state === "written" || draft.state === "kept") && onOpenDraft;
  return (
    <CardShell kind="final" label={name} onOpen={onOpen}>
      <header className="flex min-w-0 items-center gap-2 px-3 pt-3">
        <Film size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <CardName text={name} onOpen={onOpen} className="shrink-0 text-[17px] font-semibold leading-6" />
        <span data-final-title="" dir="auto" title={title} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink-secondary">{title}</span>
        {durationMs ? <span data-final-length="" className="shrink-0 text-[12px] leading-4 text-ink-tertiary tabular-nums">{clockLength(durationMs)}</span> : null}
      </header>
      <div data-final-media="" className="mx-3 mt-2 h-[236px] shrink-0 overflow-hidden rounded-lg">
        {videoUrl ? (
          <InlineVideo src={videoUrl} posterUrl={coverUrl} label={t("boardCards.result.play", { name })} onPlay={onPlay} className="size-full" />
        ) : coverUrl ? (
          <img src={coverUrl} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <PicturePlaceholder>
            <Film size={14} aria-hidden="true" />
            <span>{t("boardCards.final.noFilm")}</span>
          </PicturePlaceholder>
        )}
      </div>
      <section className="flex flex-col gap-1.5 px-3 pt-3">
        {!videoUrl && ready < clips.length ? (
          <span data-final-progress="" className="text-[12px] leading-4 text-ink-tertiary tabular-nums">{t("boardCards.final.waiting", { ready, total: clips.length })}</span>
        ) : null}
        <ol className="flex h-7 gap-0.5">
          {clips.map((clip) => {
            const code = shotCode(clip.number);
            return (
              <li
                key={clip.number}
                data-final-clip={clip.state}
                title={clip.state === "ready" ? t("boardCards.final.clipReady", { code }) : t("boardCards.final.clipMissing", { code })}
                style={{ flexGrow: clip.durationMs || UNTIMED_CLIP_MS }}
                className={cn("flex min-w-0 basis-0 items-center overflow-hidden rounded-[4px] px-1.5 font-mono text-[12px] leading-4", CLIP_LOOK[clip.state])}
              >
                <span className="truncate">{code}</span>
              </li>
            );
          })}
        </ol>
      </section>
      {draft ? (
        <div data-final-draft="" className="mt-auto flex min-w-0 items-center gap-2 px-3 pb-3 pt-3">
          <Scissors size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
          <div className="min-w-0 flex-1">
            <CardLabel>{t("boardCards.draft.label")}</CardLabel>
            <div data-final-draft-state="" dir="auto" title={draftText(draft)} className="truncate text-[13px] leading-[18px] text-ink">{draftText(draft)}</div>
          </div>
          {opens ? <CardAction icon={<ExternalLink size={14} aria-hidden="true" />} label={t("boardCards.draft.open")} onClick={onOpenDraft} /> : null}
        </div>
      ) : null}
    </CardShell>
  );
}
