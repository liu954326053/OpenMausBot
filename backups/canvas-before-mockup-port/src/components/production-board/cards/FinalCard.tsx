import { ExternalLink, Film, Scissors, Volume2 } from "lucide-react";
import { episodeCode, shotCode } from "../../../../shared/production";
import type { ProjectDraftWire } from "../../../../shared/project-draft";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardName, CardShell, clockLength, InlineVideo, MonitorButton } from "./parts";
import { BOARD_CARD_SIZES } from "./sizes";
import type { BoardTone } from "./tone";

/** One of the episode's shots, in the order the film plays. */
export interface FinalClip {
  number: number;
  state: "ready" | "generating" | "failed" | "missing";
  durationMs?: number;
  /** A still of its selected take, drawn on a ready shot while the strip has room for each shot's code. */
  posterUrl?: string;
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
  /** The draft's name in JianYing's draft list; `draft.name` when not given. */
  draftName?: string;
  onOpen?: () => void;
  onPlay?: () => void;
  /** JianYing cannot be told which draft to open, so this only brings JianYing to the front. */
  onOpenDraft?: () => void;
}

const CLIP_LOOK: Readonly<Record<FinalClip["state"], string>> = {
  ready: "bg-board-teal/25 text-board-paper",
  generating: "bg-board-amber/25 text-board-amber",
  failed: "bg-board-paper/10 text-board-paper",
  missing: "border border-dashed border-board-paper/25 text-board-paper/50",
};
const UNTIMED_CLIP_MS = 5000;
const STRIP_WIDTH = BOARD_CARD_SIZES.final.width - 2 * 14;
const CLIP_GAP = 2;
const LABELLED_CLIP_MIN_WIDTH = 40;
const LABELLED_CLIPS_MAX = Math.floor((STRIP_WIDTH + CLIP_GAP) / (LABELLED_CLIP_MIN_WIDTH + CLIP_GAP));

function draftText(draft: ProjectDraftWire): string | undefined {
  switch (draft.state) {
    case "written": return undefined;
    case "kept": return t("boardCards.draft.kept");
    case "none": return t("boardCards.draft.none");
    case "unavailable":
      return draft.reason === "remote" ? t("boardCards.draft.remote")
        : draft.reason === "unsupported-version" ? t("boardCards.draft.unsupportedVersion")
        : t("boardCards.draft.notInstalled");
  }
}

function DraftRow({ draft, draftName, onOpenDraft }: { draft: ProjectDraftWire; draftName?: string; onOpenDraft?: () => void }) {
  const exists = draft.state === "written" || draft.state === "kept";
  const name = exists ? draftName?.trim() || draft.name?.trim() : undefined;
  const text = draftText(draft);
  return (
    <div data-final-draft="" className="mt-auto flex min-w-0 items-center gap-2 px-3.5 pb-3 pt-2">
      <Scissors size={14} aria-hidden="true" className="shrink-0 text-board-paper/50" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] leading-4 text-board-paper/50">{t("boardCards.draft.label")}</div>
        {name ? <div data-final-draft-name="" dir="auto" title={name} className="truncate text-[13px] leading-[18px] text-board-paper">{name}</div> : null}
        {text ? (
          <div data-final-draft-state="" dir="auto" title={text} className={cn("truncate", exists ? "text-[11px] leading-4 text-board-paper/50" : "text-[13px] leading-[18px] text-board-paper")}>{text}</div>
        ) : null}
      </div>
      {exists && onOpenDraft ? (
        <MonitorButton
          icon={<ExternalLink size={12} aria-hidden="true" />}
          label={t("boardCards.draft.open")}
          title={name ? t("boardCards.draft.findIn", { name }) : undefined}
          onClick={onOpenDraft}
        />
      ) : null}
    </div>
  );
}

function clipSpan(clips: readonly FinalClip[], total: number) {
  let at = 0;
  return clips.map((clip) => {
    const duration = clip.durationMs || UNTIMED_CLIP_MS;
    const left = (at / total) * 100;
    at += duration;
    return { clip, left, width: (duration / total) * 100 };
  });
}

export function FinalCard({ episode, title, coverUrl, videoUrl, durationMs, clips, draft, draftName, onOpen, onPlay, onOpenDraft }: FinalCardProps) {
  const name = t("boardCards.final.title", { episode: episodeCode(episode) });
  const ready = clips.filter((clip) => clip.state === "ready").length;
  const labelled = clips.length <= LABELLED_CLIPS_MAX;
  const total = durationMs ?? clips.reduce((sum, clip) => sum + (clip.durationMs || UNTIMED_CLIP_MS), 0);
  const spans = clipSpan(clips, Math.max(total, 1));
  const tone: BoardTone = videoUrl ? "done" : ready > 0 ? "working" : "idle";
  const status = videoUrl
    ? t("boardCards.status.done")
    : ready === clips.length && clips.length > 0
      ? t("boardCards.episode.status.post")
      : t("boardCards.final.waiting", { ready, total: clips.length });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => clockLength(total * share));
  return (
    <CardShell kind="final" label={name} surface="monitor" onOpen={onOpen}>
      <header className="flex min-w-0 items-center gap-2 px-3.5 pb-1.5 pt-3">
        <Film size={14} aria-hidden="true" className="shrink-0 text-board-paper/50" />
        <CardName text={name} onOpen={onOpen} className="shrink-0 text-[17px] font-semibold leading-6 text-board-paper" />
        <span className="min-w-0 flex-1" />
        <span data-final-status={tone} data-final-progress={!videoUrl && ready < clips.length ? "" : undefined} className="inline-flex shrink-0 items-center gap-1.5 text-[12px] leading-4 text-board-paper/60">
          <i aria-hidden="true" className={cn("size-2 rounded-full", tone === "done" ? "bg-board-teal" : tone === "working" ? "bg-board-amber" : "bg-board-paper/30")} />
          <span data-final-status-text="" className="truncate">{status}</span>
        </span>
      </header>
      <div data-final-media="" className="relative mx-3.5 mt-1 aspect-video shrink-0 overflow-hidden rounded-lg bg-board-monitor">
        {videoUrl ? (
          <InlineVideo src={videoUrl} posterUrl={coverUrl} label={t("boardCards.result.play", { name })} onPlay={onPlay} className="size-full" />
        ) : coverUrl ? (
          <img src={coverUrl} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-[12px] leading-4 text-board-paper/50">
            <Film size={16} aria-hidden="true" />
            <span>{t("boardCards.final.noFilm")}</span>
          </div>
        )}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-board-monitor/95 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex min-w-0 flex-col gap-0.5 px-4 pb-3">
          <strong data-final-title="" data-final-headline="" dir="auto" title={title} className="truncate text-[32px] font-semibold leading-9 tracking-[0.12em] text-board-paper">{title}</strong>
          <span className="inline-flex items-center gap-2 text-[13px] leading-4 text-board-paper/70">
            <span className="font-mono">{episodeCode(episode)}</span>
            {total ? <span className="font-mono" data-final-length="">{clockLength(total)}</span> : null}
          </span>
        </div>
      </div>
      <section data-final-timeline="" className="flex flex-col gap-1 px-3.5 pt-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-14 shrink-0" />
          <div className="flex min-w-0 flex-1 justify-between font-mono text-[11px] leading-4 text-board-paper/60">
            {ticks.map((tick, index) => <span key={index}>{tick}</span>)}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex w-14 shrink-0 items-center gap-1 text-[11px] leading-4 text-board-paper/50"><Film size={12} aria-hidden="true" />{t("boardCards.final.videoTrack")}</span>
          <div className="relative h-10 min-w-0 flex-1 overflow-hidden rounded bg-board-paper/[0.04]">
            {spans.map(({ clip, left, width }) => (
              <div
                key={clip.number}
                data-final-clip={clip.state}
                title={clip.state === "ready" ? t("boardCards.final.clipReady", { code: shotCode(clip.number) }) : t("boardCards.final.clipMissing", { code: shotCode(clip.number) })}
                style={{ left: `${left}%`, width: `${width}%` }}
                className={cn("absolute inset-y-0 flex items-end overflow-hidden rounded-sm", CLIP_LOOK[clip.state])}
              >
                {clip.posterUrl && labelled && clip.state === "ready" ? <img src={clip.posterUrl} alt="" draggable={false} className="absolute inset-0 size-full object-cover" /> : null}
                {labelled ? <span className={cn("relative truncate px-1 font-mono text-[11px] leading-4", clip.posterUrl && clip.state === "ready" && "rounded-tr bg-board-monitor/75 text-board-paper")}>{shotCode(clip.number)}</span> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex w-14 shrink-0 items-center gap-1 text-[11px] leading-4 text-board-paper/50"><Volume2 size={12} aria-hidden="true" />{t("boardCards.final.audioTrack")}</span>
          <div className="relative h-5 min-w-0 flex-1 overflow-hidden rounded bg-board-paper/[0.04]">
            {spans.map(({ clip, left, width }) => (
              <i
                key={clip.number}
                data-final-audio={clip.state}
                style={{ left: `${left}%`, width: `${width}%` }}
                className={cn("absolute inset-y-1 rounded-sm border border-dashed", clip.state === "ready" ? "border-board-paper/30 bg-board-paper/[0.06]" : "border-board-paper/15")}
              />
            ))}
          </div>
        </div>
      </section>
      {draft ? <DraftRow draft={draft} draftName={draftName} onOpenDraft={onOpenDraft} /> : <div className="h-3 shrink-0" />}
    </CardShell>
  );
}
