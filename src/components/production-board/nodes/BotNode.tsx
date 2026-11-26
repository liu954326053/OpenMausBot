import { BookOpen, Check, Circle, LoaderCircle, MessageSquare, Paperclip, RotateCcw } from "lucide-react";
import { episodeCode, isEpisodeJob, type ProductionSource } from "../../../../shared/production";
import type { CanvasBotState } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import { botStatus } from "@/lib/production-board/status";
import type { BoardBotCard, BoardCount, BoardGate } from "@/lib/production-board/types";
import { BotFace, Chips, Ic, JOB_ICON, jobKey, Meter, timeOfDay, type JobKey, type NodeContext } from "./parts";

const STEPS_SHOWN = 4;
const SKILLS = [1, 2, 3] as const;

/** An episode's bot is named after the bot it is a copy of, with the episode's code; the card shows the code apart. */
function ownName(name: string, episode: number | undefined): string {
  if (episode === undefined) return name;
  const code = episodeCode(episode);
  if (!name.endsWith(code)) return name;
  return name.slice(0, -code.length).replace(/[\s·]+$/, "") || name;
}

function jobTitle(bot: CanvasBotState, key: JobKey): string {
  if (bot.title.trim()) return bot.title;
  if (key === "lead") return t("boardCards.bot.lead");
  return key === "other" ? bot.name : t(`boardCards.plan.job.${key}`);
}

function taskText(card: BoardBotCard): string | undefined {
  const { job } = card;
  if (job && isEpisodeJob(job)) return card.episode === undefined ? t(`boardCards.plan.job.${job}`) : t(`boardCards.bot.task.${job}`, { episode: episodeCode(card.episode) });
  if (job) return t(`boardCards.bot.task.${job}`);
  return card.lead ? t("boardCards.bot.task.lead") : undefined;
}

const percentOf = ({ done, total }: BoardCount): number => (total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0);

function SourceBlock({ source, episodes, ctx }: { source: ProductionSource; episodes?: number; ctx: NodeContext }) {
  const meta = [source.author, ...(source.tags ?? [])].filter(Boolean).join(" · ");
  return (
    <div className="bot-book">
      <div className="nv-cover">
        {source.cover ? <img src={ctx.fileUrl(source.cover)} alt={t("boardCards.bot.source.cover", { title: source.title })} draggable={false} /> : null}
        <span className="nv-title">{source.title}</span>
      </div>
      <div className="nv-body">
        <span className="kicker"><Ic icon={BookOpen} />{t("boardCards.bot.source.kicker")}</span>
        <h3>{source.title}</h3>
        {meta ? <p className="nv-meta">{meta}</p> : null}
        {source.quote ? <blockquote>{source.quote}</blockquote> : null}
        <div className="nv-foot">
          {episodes ? <span className="tag">{t("boardCards.bot.source.plan", { count: episodes })}</span> : <span />}
          {source.from ? <span className="src"><Ic icon={Paperclip} />{source.from}</span> : null}
        </div>
      </div>
    </div>
  );
}

interface GateItem {
  key: "characters" | "scenes" | "script";
  value: string;
  ready: boolean;
}

function gateItems(gate: BoardGate, episode: number | undefined): GateItem[] {
  const counted = (key: "characters" | "scenes", count: BoardCount | undefined): GateItem[] =>
    count ? [{ key, value: `${count.done}/${count.total}`, ready: count.total > 0 && count.done >= count.total }] : [];
  const script: GateItem[] = gate.script === undefined ? [] : [{ key: "script", value: episode === undefined ? "" : episodeCode(episode), ready: gate.script }];
  return [...counted("characters", gate.characters), ...counted("scenes", gate.scenes), ...script];
}

function GateBlock({ gate, episode }: { gate: BoardGate; episode: number | undefined }) {
  return (
    <div className="bot-gate">
      <span className="lbl">{t("boardCards.gate.label")}</span>
      <div className="gts">
        {gateItems(gate, episode).map(({ key, value, ready }) => {
          const label = t(`boardCards.gate.${key}`);
          return (
            <span key={key} className="gt" data-ready={String(ready)} title={`${label} · ${t(ready ? "boardCards.gate.ready" : "boardCards.gate.notReady")}`}>
              <Ic icon={ready ? Check : Circle} />
              {label}
              {value ? <b className="mono">{value}</b> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function BotNode({ card, ctx }: { card: BoardBotCard; ctx: NodeContext }) {
  const bot = ctx.snapshot.bots[card.botId]!;
  const key = jobKey(card);
  const title = jobTitle(bot, key);
  const code = card.episode === undefined ? undefined : episodeCode(card.episode);
  const status = botStatus(bot, card.jobStatus);
  const working = bot.status === "working";
  const doing = working ? bot.doing?.trim() : undefined;
  const progressLabel = card.progress ? t(`boardCards.progress.${card.progress.unit}`, { done: card.progress.done, total: card.progress.total }) : "";
  const steps = (bot.steps ?? []).slice(-STEPS_SHOWN);
  const { retry } = card;
  const onRetry = ctx.actions.retry;
  return (
    <>
      <div className="pin" aria-hidden="true">
        <Ic icon={JOB_ICON[key]} />
        <span>{code ? t("boardCards.bot.pin.episode", { job: title, episode: code }) : title}</span>
        <i className="led" />
      </div>
      <header className="bot-head">
        <span className="bot-ava"><BotFace botId={card.botId} ctx={ctx} size={40} fallback={key} /></span>
        <div className="bot-id">
          <strong>{ownName(bot.name, card.episode)}{code ? <em className="bot-ep mono">{code}</em> : null}</strong>
          <span>{title}</span>
        </div>
        <span className="bot-status"><i className="led" />{status.label}</span>
      </header>
      {card.source ? <SourceBlock source={card.source} episodes={card.episodes} ctx={ctx} /> : null}
      {card.gate ? <GateBlock gate={card.gate} episode={card.episode} /> : null}
      <div className="bot-task">
        <span className="lbl">{t("boardCards.bot.currentTask")}</span>
        <p>{doing || taskText(card) || t("boardCards.bot.noTask")}</p>
        {card.progress ? (
          <>
            <Meter percent={percentOf(card.progress)} label={progressLabel} />
            <div className="meter-meta">
              <span>{t("boardCards.progress.complete", { label: progressLabel })}</span>
              <span>{`${percentOf(card.progress)}%`}</span>
            </div>
          </>
        ) : null}
      </div>
      {steps.length ? (
        <ul className="bot-log" aria-label={t("boardCards.bot.steps")}>
          {steps.map((step, index) => {
            const running = working && index === steps.length - 1;
            return (
              <li key={index} data-s={running ? "run" : "done"}>
                <Ic icon={running ? LoaderCircle : Check} className={running ? "spin" : undefined} />
                <span>{step.text}</span>
                <time dateTime={new Date(step.at).toISOString()}>{timeOfDay(step.at)}</time>
              </li>
            );
          })}
        </ul>
      ) : null}
      <footer className="bot-foot">
        {key === "other" ? null : <Chips items={SKILLS.map((n) => t(`productionBoard.skills.${key}.${n}`))} />}
        {retry && onRetry ? (
          <button type="button" className="btn-ink" onClick={() => onRetry(retry)}>
            <Ic icon={RotateCcw} />
            {t("boardCards.retry")}
          </button>
        ) : null}
        <button type="button" className="bot-talk" onClick={() => ctx.actions.openChat(card.botId)}>
          <Ic icon={MessageSquare} />
          {t("boardCards.bot.talk")}
        </button>
      </footer>
    </>
  );
}
