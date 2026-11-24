import { RotateCcw, Sparkles, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { episodeCode, shotCode } from "../../../../shared/production";
import type { CanvasShotDesign } from "../../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardName, CardShell, clockLength, failureText, PAPER_HEAD_RULE, PaperButton, PaperCode, PaperStatus, StaleMark, type BoardGeneration } from "./parts";
import type { BoardStatus } from "./tone";

/** A character or a scene a shot is drawn with. */
export interface BoardReference {
  kind: "character" | "scene";
  name: string;
  pictureUrl?: string;
}

export interface ShotCardProps {
  number: number;
  episode?: number;
  title: string;
  design?: CanvasShotDesign;
  seconds?: number;
  /** Where it starts in its episode, in seconds. */
  startsAt?: number;
  /** What the shot shows. */
  prompt?: string;
  references?: readonly BoardReference[];
  /** Names each reference beside its picture when the names fit; the pictures alone otherwise, and while a failure
   * needs the room. */
  referenceNames?: boolean;
  /** How many videos were made of it. */
  takes?: number;
  /** How its newest video is being made. */
  generation?: BoardGeneration;
  /** The shot node's `metadata.stale`. */
  stale?: boolean;
  onOpen?: () => void;
  onGenerate?: () => void;
}

const DASH = "—";

function videoStatus(generation: BoardGeneration | undefined, takes: number): BoardStatus {
  if (generation?.status === "loading") return { tone: "working", label: t("boardCards.generating") };
  if (generation?.status === "error") return { tone: "failed", label: t("boardCards.generationFailed") };
  if (takes > 0) return { tone: "done", label: t("boardCards.video.ready") };
  return { tone: "idle", label: t("boardCards.video.none") };
}

const NAMED_REFERENCES_ROOM = 260;
const WIDE_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

/** At most how wide a name tag runs: its 12px name, then its 16px picture, the gap and the padding. */
function nameTagWidth(name: string): number {
  return [...name].reduce((width, character) => width + (WIDE_CHARACTER.test(character) ? 12 : 7), 16 + 4 + 2 + 8);
}

function namesFit(references: readonly BoardReference[]): boolean {
  const gaps = 4 * (references.length - 1);
  return references.reduce((width, reference) => width + nameTagWidth(reference.name.trim()), gaps) <= NAMED_REFERENCES_ROOM;
}

function Picture({ reference, className }: { reference: BoardReference; className: string }) {
  const shape = reference.kind === "scene" ? "rounded" : "rounded-full";
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-board-paper-2 font-medium text-board-ink-2", shape, className)}>
      {reference.pictureUrl
        ? <img src={reference.pictureUrl} alt="" draggable={false} className="size-full object-cover" />
        : [...reference.name.trim()][0]?.toUpperCase()}
    </span>
  );
}

function References({ references, named }: { references: readonly BoardReference[]; named: boolean }) {
  if (!named) {
    return (
      <div data-shot-references="" aria-label={t("boardCards.shot.references")} className="flex shrink-0 items-center -space-x-1">
        {references.map((reference, index) => (
          <span key={index} data-shot-reference={reference.kind} title={reference.name} className="flex">
            <Picture reference={reference} className="size-6 text-[12px] ring-2 ring-board-paper" />
          </span>
        ))}
      </div>
    );
  }
  return (
    <ul data-shot-references="" aria-label={t("boardCards.shot.references")} className="flex min-w-0 items-center gap-1 overflow-hidden">
      {references.map((reference, index) => (
        <li key={index} data-shot-reference={reference.kind} title={reference.name} className="inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-board-paper-line bg-board-paper-2 pe-2 ps-1 text-[12px] font-medium text-board-ink">
          <Picture reference={reference} className="size-4 text-[11px]" />
          <span data-shot-reference-name="" dir="auto" className="min-w-0 truncate">{reference.name}</span>
        </li>
      ))}
    </ul>
  );
}

function timeIn(startsAt: number, seconds: number | undefined): string {
  const start = clockLength(startsAt * 1000);
  return seconds ? `${start} – ${clockLength((startsAt + seconds) * 1000)}` : start;
}

export function ShotCard({ number, episode, title, design, seconds, startsAt, prompt, references, referenceNames, takes = 0, generation, stale, onOpen, onGenerate }: ShotCardProps) {
  const status = videoStatus(generation, takes);
  const code = shotCode(number);
  const time = startsAt === undefined ? undefined : timeIn(startsAt, seconds);
  const timeMark = time ? (
    <span data-shot-time="" title={episode === undefined ? time : t("boardCards.shot.time", { time, episode: episodeCode(episode) })} className="ms-2 font-mono text-[12px] leading-4 text-board-ink-3 tabular-nums">
      {time}
    </span>
  ) : undefined;
  const facts: Array<[label: string, value: string | undefined, after?: ReactNode]> = [
    [t("boardCards.shot.size"), design?.size?.trim()],
    [t("boardCards.shot.move"), design?.move?.trim()],
    [t("boardCards.shot.length"), seconds ? t("boardCards.shot.seconds", { count: seconds }) : undefined, timeMark],
  ];
  const audio = design?.audio?.trim();
  const text = prompt?.trim();
  const named = Boolean(referenceNames) && generation?.status !== "error" && Boolean(references?.length) && namesFit(references!);
  return (
    <CardShell kind="shot" label={`${code} ${title}`} tone={status.tone === "failed" ? "failed" : undefined} surface="paper" onOpen={onOpen}>
      <header className={cn("flex min-w-0 items-center gap-2 px-3.5 pb-1.5 pt-2", PAPER_HEAD_RULE)}>
        <span data-shot-code="" title={episode === undefined ? code : `${episodeCode(episode)} ${code}`}><PaperCode text={code} /></span>
        <CardName text={title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6 text-board-ink" />
        {stale ? <StaleMark reason={t("boardCards.stale.shot")} className="bg-board-paper-2 text-board-ink-2" /> : null}
      </header>
      <dl className="grid grid-cols-3 gap-3 px-3.5 pt-1.5">
        {facts.map(([label, value, after]) => (
          <div key={label} data-shot-fact="" className="min-w-0">
            <dt className="truncate text-[12px] leading-4 text-board-ink-3">{label}</dt>
            <dd dir="auto" title={value} className={cn("truncate text-[13px] font-semibold leading-[18px]", value ? "text-board-ink" : "text-board-ink-3")}>
              {value ?? (after ? null : DASH)}
              {after}
            </dd>
          </div>
        ))}
      </dl>
      <p data-shot-prompt="" dir="auto" title={text} className={cn("line-clamp-2 px-3.5 pt-1.5 text-[13px] leading-[17px]", text ? "text-board-ink-2" : "text-board-ink-3")}>
        {text || t("boardCards.shot.noPrompt")}
      </p>
      {audio ? (
        <div className="flex min-w-0 items-center gap-1.5 px-3.5 pt-1 text-[12px] leading-4 text-board-ink-2">
          <Volume2 size={12} aria-label={t("boardCards.shot.sound")} className="shrink-0 text-board-ink-3" />
          <span data-shot-audio="" dir="auto" title={audio} className="min-w-0 truncate">{audio}</span>
        </div>
      ) : null}
      {references?.length ? (
        <div className="flex min-w-0 items-center gap-2 px-3.5 pt-1">
          <span className="shrink-0 text-[12px] leading-4 text-board-ink-3">{t("boardCards.shot.references")}</span>
          <References references={references} named={named} />
        </div>
      ) : null}
      <footer className="mt-auto flex min-w-0 items-center gap-2 border-t border-dashed border-board-paper-line px-3.5 pb-2 pt-1.5">
        <PaperStatus status={status} />
        {generation?.status === "error" ? (
          <span data-shot-failure="" title={failureText(generation)} className="min-w-0 flex-1 truncate text-[12px] leading-4 text-board-ink-2">{failureText(generation)}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-4 text-board-ink-3">
            {takes > 0 ? <span data-shot-takes="">{t("boardCards.result.takes", { count: takes })}</span> : null}
          </span>
        )}
        {onGenerate && generation?.status !== "loading" ? (
          takes > 0 || generation?.status === "error" ? (
            <PaperButton icon={<RotateCcw size={12} aria-hidden="true" />} label={t("boardCards.generateAgain")} onClick={onGenerate} />
          ) : (
            <PaperButton kind="generate" icon={<Sparkles size={12} aria-hidden="true" />} label={t("boardCards.video.generateShot")} onClick={onGenerate} />
          )
        ) : null}
      </footer>
    </CardShell>
  );
}
