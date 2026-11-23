import { ExternalLink, Film, Scissors } from "lucide-react";
import { episodeCode, shotCode } from "../../../../shared/production";
import type { ProjectDraftWire } from "../../../../shared/project-draft";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardAction, CardLabel, CardName, CardShell, clockLength, InlineVideo, PicturePlaceholder } from "./parts";
import { BOARD_CARD_SIZES } from "./sizes";

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
  ready: "bg-success/25 text-ink",
  generating: "bg-accent/20 text-ink-secondary",
  failed: "bg-danger/20 text-danger",
  missing: "border border-dashed border-ink-tertiary/60 text-ink-tertiary",
};
const UNTIMED_CLIP_MS = 5000;
const STRIP_WIDTH = BOARD_CARD_SIZES.final.width - 2 * 12;
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
    <div data-final-draft="" className="mt-auto flex min-w-0 items-center gap-2 px-3 pb-3 pt-3">
      <Scissors size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
      <div className="min-w-0 flex-1">
        <CardLabel>{t("boardCards.draft.label")}</CardLabel>
        {name ? <div data-final-draft-name="" dir="auto" title={name} className="truncate text-[13px] leading-[18px] text-ink-secondary">{name}</div> : null}
        {text ? (
          <div data-final-draft-state="" dir="auto" title={text} className={cn("truncate", exists ? "text-[12px] leading-4 text-ink-tertiary" : "text-[13px] leading-[18px] text-ink")}>{text}</div>
        ) : null}
      </div>
      {exists && onOpenDraft ? (
        <CardAction
          icon={<ExternalLink size={14} aria-hidden="true" />}
          label={t("boardCards.draft.open")}
          title={name ? t("boardCards.draft.findIn", { name }) : undefined}
          onClick={onOpenDraft}
        />
      ) : null}
    </div>
  );
}

export function FinalCard({ episode, title, coverUrl, videoUrl, durationMs, clips, draft, draftName, onOpen, onPlay, onOpenDraft }: FinalCardProps) {
  const name = t("boardCards.final.title", { episode: episodeCode(episode) });
  const ready = clips.filter((clip) => clip.state === "ready").length;
  const labelled = clips.length <= LABELLED_CLIPS_MAX;
  const stillOf = (clip: FinalClip) => (labelled && clip.state === "ready" ? clip.posterUrl : undefined);
  return (
    <CardShell kind="final" label={name} onOpen={onOpen}>
      <header className="flex min-w-0 items-center gap-2 px-3 pt-3">
        <Film size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <CardName text={name} onOpen={onOpen} className="shrink-0 text-[17px] font-semibold leading-6" />
        <span data-final-title="" dir="auto" title={title} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink-secondary">{title}</span>
        {durationMs ? <span data-final-length="" className="shrink-0 text-[12px] leading-4 text-ink-tertiary tabular-nums">{clockLength(durationMs)}</span> : null}
      </header>
      <div data-final-media="" className="mx-3 mt-2 h-59 shrink-0 overflow-hidden rounded-lg">
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
        <ol className={cn("flex", clips.some(stillOf) ? "h-12" : "h-7")} style={{ gap: CLIP_GAP }}>
          {clips.map((clip) => {
            const code = shotCode(clip.number);
            const still = stillOf(clip);
            return (
              <li
                key={clip.number}
                data-final-clip={clip.state}
                title={clip.state === "ready" ? t("boardCards.final.clipReady", { code }) : t("boardCards.final.clipMissing", { code })}
                style={{ flexGrow: clip.durationMs || UNTIMED_CLIP_MS, minWidth: labelled ? LABELLED_CLIP_MIN_WIDTH : 0 }}
                className={cn("relative flex basis-0 overflow-hidden rounded-md font-mono text-[12px] leading-4", still ? "items-end p-0.5" : "items-center px-1.5", CLIP_LOOK[clip.state])}
              >
                {still ? <img src={still} alt="" draggable={false} className="absolute inset-0 size-full object-cover" /> : null}
                {labelled ? <span className={cn("truncate", still && "relative rounded-full bg-card px-1 text-[11px] text-ink-secondary")}>{code}</span> : null}
              </li>
            );
          })}
        </ol>
      </section>
      {draft ? <DraftRow draft={draft} draftName={draftName} onOpenDraft={onOpenDraft} /> : null}
    </CardShell>
  );
}
