import { Sparkles, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { episodeCode } from "../../../../shared/production";
import type { CanvasShotDesign } from "../../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CardAction, CardName, CardShell, clockLength, failureText, shotCode, StaleMark, StatusMark, type BoardGeneration } from "./parts";
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

const NAMED_REFERENCES_ROOM = 220;
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
  const shape = reference.kind === "scene" ? "rounded-md" : "rounded-full";
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden font-medium text-ink-secondary", shape, className)}>
      {reference.pictureUrl
        ? <img src={reference.pictureUrl} alt="" draggable={false} className="size-full object-cover" />
        : [...reference.name.trim()][0]?.toUpperCase()}
    </span>
  );
}

function References({ references, named }: { references: readonly BoardReference[]; named: boolean }) {
  if (!named) {
    return (
      <div aria-label={t("boardCards.shot.references")} className="flex shrink-0 items-center -space-x-1">
        {references.map((reference, index) => (
          <span key={index} data-shot-reference={reference.kind} title={reference.name} className="flex">
            <Picture reference={reference} className="size-6 bg-control text-[12px] ring-2 ring-card" />
          </span>
        ))}
      </div>
    );
  }
  return (
    <ul aria-label={t("boardCards.shot.references")} className="flex min-w-0 items-center gap-1">
      {references.map((reference, index) => (
        <li key={index} data-shot-reference={reference.kind} title={reference.name} className="ui-chip min-w-0 bg-control ps-0.5 text-ink-secondary">
          <Picture reference={reference} className="size-4 bg-card text-[11px]" />
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
    <span data-shot-time="" title={episode === undefined ? time : t("boardCards.shot.time", { time, episode: episodeCode(episode) })} className={cn("text-[12px] text-ink-tertiary tabular-nums", seconds && "ms-1.5")}>
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
  return (
    <CardShell kind="shot" label={`${code} ${title}`} tone={status.tone === "failed" ? "failed" : undefined} onOpen={onOpen}>
      <header className="flex items-center gap-2 px-3 pt-3">
        <span data-shot-code="" title={episode === undefined ? code : `${episodeCode(episode)} ${code}`} className="ui-chip shrink-0 bg-control font-mono text-ink-secondary">{code}</span>
        <CardName text={title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6" />
        {stale ? <StaleMark reason={t("boardCards.stale.shot")} /> : null}
        <StatusMark status={status} />
      </header>
      <dl className="grid grid-cols-3 gap-3 px-3 pt-2">
        {facts.map(([label, value, after]) => (
          <div key={label} data-shot-fact="" className="min-w-0">
            <dt className="truncate text-[12px] leading-4 text-ink-tertiary">{label}</dt>
            <dd dir="auto" title={value} className={cn("truncate text-[13px] leading-[18px]", value ? "text-ink" : "text-ink-tertiary")}>
              {value ?? (after ? null : DASH)}
              {after}
            </dd>
          </div>
        ))}
      </dl>
      <p data-shot-prompt="" dir="auto" title={text} className={cn("line-clamp-2 px-3 pt-2 text-[13px] leading-[18px]", text ? "text-ink-secondary" : "text-ink-tertiary")}>
        {text || t("boardCards.shot.noPrompt")}
      </p>
      {audio ? (
        <div className="flex min-w-0 items-center gap-1.5 px-3 pt-1.5 text-[12px] leading-4 text-ink-tertiary">
          <Volume2 size={14} aria-label={t("boardCards.shot.sound")} className="shrink-0" />
          <span data-shot-audio="" dir="auto" title={audio} className="min-w-0 truncate">{audio}</span>
        </div>
      ) : null}
      <footer className="mt-auto flex min-w-0 items-center gap-2 px-3 pb-3 pt-2">
        {references?.length
          ? <References references={references} named={Boolean(referenceNames) && generation?.status !== "error" && namesFit(references)} />
          : null}
        {generation?.status === "error" ? (
          <span data-shot-failure="" title={failureText(generation)} className="min-w-0 flex-1 truncate text-[12px] leading-4 text-danger">{failureText(generation)}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink-tertiary">
            {takes > 0 ? <span data-shot-takes="">{t("boardCards.result.takes", { count: takes })}</span> : null}
          </span>
        )}
        {onGenerate && generation?.status !== "loading" ? (
          <CardAction
            icon={<Sparkles size={14} aria-hidden="true" />}
            label={takes > 0 || generation?.status === "error" ? t("boardCards.generateAgain") : t("boardCards.video.generate")}
            onClick={onGenerate}
          />
        ) : null}
      </footer>
    </CardShell>
  );
}
