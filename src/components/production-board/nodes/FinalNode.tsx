import { Captions, ExternalLink, Film, Mic, Music, Video, type LucideIcon } from "lucide-react";
import { episodeCode, shotCode } from "../../../../shared/production";
import type { DraftTrackWire, ProjectDraftWire } from "../../../../shared/project-draft";
import { t } from "@/lib/i18n";
import type { BoardClip, BoardFinalCard } from "@/lib/production-board/types";
import { Chips, clock, Ic, type NodeContext } from "./parts";

const UNTIMED_CLIP_MS = 5000;
const TICKS = 6;

const CLIP_STATE: Readonly<Record<BoardClip["state"], string>> = { ready: "done", generating: "gen", failed: "failed", missing: "todo" };
const TRACK_ICON: Readonly<Record<DraftTrackWire["kind"], LucideIcon>> = { voice: Mic, subtitle: Captions, music: Music };

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

function filmStatus(card: BoardFinalCard): { text: string; led?: "done" | "working" } {
  const ready = card.clips.filter((clip) => clip.state === "ready").length;
  if (card.film?.file) return { text: t("boardCards.status.done"), led: "done" };
  if (card.clips.length && ready === card.clips.length) return { text: t("boardCards.episode.status.post"), led: "working" };
  return { text: t("boardCards.final.waiting", { ready, total: card.clips.length }), ...(ready ? { led: "working" as const } : {}) };
}

/** A clip without a length takes the average of those with one. */
function clipLengths(clips: readonly BoardClip[]): number[] {
  const timed = clips.flatMap((clip) => (clip.durationMs ? [clip.durationMs] : []));
  const fallback = timed.length ? timed.reduce((sum, ms) => sum + ms, 0) / timed.length : UNTIMED_CLIP_MS;
  return clips.map((clip) => clip.durationMs ?? fallback);
}

function resolution(card: BoardFinalCard, ctx: NodeContext): string | undefined {
  const firstTake = card.clips.map((clip) => ctx.takeOf(clip.shotId)).find((take) => take?.file);
  const nodeId = card.film?.nodeId ?? firstTake?.nodeId;
  const metadata = ctx.snapshot.nodes.find((node) => node.id === nodeId)?.metadata;
  return metadata?.naturalWidth && metadata.naturalHeight ? `${metadata.naturalWidth}×${metadata.naturalHeight}` : undefined;
}

export function FinalNode({ card, ctx }: { card: BoardFinalCard; ctx: NodeContext }) {
  const status = filmStatus(card);
  const lengths = clipLengths(card.clips);
  const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, ms) => sum + ms, 0));
  const tracks = card.draft?.tracks ?? [];
  const trackEnd = Math.max(0, ...tracks.flatMap((track) => track.segments.map((segment) => segment.startMs + segment.durationMs)));
  const total = Math.max(1, card.film?.durationMs ?? 0, lengths.reduce((sum, ms) => sum + ms, 0), trackEnd);
  const share = (ms: number) => `${(ms / total) * 100}%`;
  const filmFile = card.film?.file;
  const firstReady = card.clips.find((clip) => clip.state === "ready");
  const still = filmFile || !firstReady ? undefined : ctx.takeOf(firstReady.shotId)?.file;
  const size = resolution(card, ctx);
  const specs = [...(size ? [size] : []), ...(card.clips.length ? [card.clips.length === 1 ? t("boardCards.final.clips.one") : t("boardCards.final.clips", { count: card.clips.length })] : [])];
  const draft = card.draft;
  const openable = Boolean(draft && (draft.state === "written" || draft.state === "kept") && ctx.actions.openDraft);
  return (
    <>
      <header className="fn-head">
        <span className="kicker"><Ic icon={Film} />{t("boardCards.final.title", { episode: episodeCode(card.episode) })}</span>
        <span className="fn-st"><i className="led" data-s={status.led} />{status.text}</span>
      </header>
      <div className="fn-mon">
        {filmFile ? (
          <video src={ctx.fileUrl(filmFile)} controls preload="metadata" playsInline />
        ) : still ? (
          <video src={`${ctx.fileUrl(still)}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" />
        ) : null}
        <div className="fn-title">
          <strong>{card.title}</strong>
          <span>{`${episodeCode(card.episode)} · ${clock(total)}`}</span>
        </div>
      </div>
      <div className="fn-tl">
        <div className="fn-row fn-rule">
          <span className="fn-lbl" />
          <div className="fn-ruler mono">
            {Array.from({ length: TICKS + 1 }, (_, index) => <span key={index} style={{ left: `${(index / TICKS) * 100}%` }}>{clock((total * index) / TICKS)}</span>)}
          </div>
        </div>
        <div className="fn-row">
          <span className="fn-lbl"><Ic icon={Video} />{t("boardCards.final.track.picture")}</span>
          <div className="fn-lane fn-video">
            {card.clips.map((clip, index) => {
              const code = shotCode(clip.number);
              return (
                <div key={clip.shotId} className="clip" data-s={CLIP_STATE[clip.state]} title={t(clip.state === "ready" ? "boardCards.final.clipReady" : "boardCards.final.clipMissing", { code })} style={{ left: share(starts[index]!), width: share(lengths[index]!) }}>
                  <span className="mono">{code}</span>
                </div>
              );
            })}
          </div>
        </div>
        {tracks.map((track, index) => (
          <div key={index} className="fn-row">
            <span className="fn-lbl"><Ic icon={TRACK_ICON[track.kind]} />{t(`boardCards.final.track.${track.kind}`)}</span>
            <div className="fn-lane">
              {track.segments.map((segment, place) => <i key={place} className="seg" style={{ left: share(segment.startMs), width: share(segment.durationMs) }} />)}
            </div>
          </div>
        ))}
      </div>
      <footer className="fn-foot">
        <Chips items={specs} />
        {draft ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={!openable}
            title={openable ? (draft.name ? t("boardCards.draft.findIn", { name: draft.name }) : undefined) : draftText(draft)}
            onClick={() => ctx.actions.openDraft?.()}
          >
            <Ic icon={ExternalLink} />
            {t("boardCards.draft.open")}
          </button>
        ) : null}
      </footer>
    </>
  );
}
