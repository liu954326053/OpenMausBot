import { ChevronDown, ChevronRight, Clapperboard } from "lucide-react";
import { memo, useCallback, useId, useRef, type ReactNode } from "react";

import { episodeCode, type EpisodeJob } from "../../../shared/production";
import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { useRememberedDisclosure } from "@/lib/remembered-disclosure";
import { sidebarAttentionLabel, sidebarSectionAttention } from "@/lib/sidebar-attention";
import type { EpisodeTeam } from "@/lib/team-projects";
import type { LocaleKey } from "@/locales";
import type { Bot } from "@/state/store";
import { SectionAttention } from "../SidebarSectionHeader";
import { SidebarProjectBot, underProjectRow } from "./SidebarProjectRow";

type EpisodesOf = Pick<TeamProjectWire, "id" | "episodeBots">;

const JOB_NAMES = {
  storyboard: "sidebarEpisodes.job.storyboard",
  post: "sidebarEpisodes.job.post",
} as const satisfies Record<EpisodeJob, LocaleKey>;

/** A drama's episodes under its open row: one row, folded at first, that unfolds into a row per episode, each folded at
 * first, that unfolds into the bots the production made for that episode. What goes on among the bots of a folded row
 * marks that row, and so does the conversation open among them. */
export function SidebarProjectEpisodes({ project, episodes, simple, gap, openChat, onOpenBot }: {
  project: EpisodesOf;
  /** As `splitEpisodes` gives them, in order. */
  episodes: EpisodeTeam<Bot>[];
  simple: boolean;
  gap: string;
  /** The conversation open in the chat view. */
  openChat: string | null;
  onOpenBot: (bot: Bot) => void;
}) {
  const [open, setOpen] = useRememberedDisclosure(`project-episodes:${project.id}`);
  const listId = useId();
  const latestOpenBot = useRef(onOpenBot);
  latestOpenBot.current = onOpenBot;
  const openBot = useCallback((bot: Bot) => latestOpenBot.current(bot), []);
  const bots = episodes.flatMap((episode) => episode.bots);
  const locale = activeLocale();
  return (
    <div data-sidebar-project-episodes={project.id} className={cn("flex flex-col", gap)}>
      <Disclosure open={open} controls={listId} simple={simple} depth={0} bots={bots} openChat={openChat} onToggle={() => setOpen(!open)}
        data={{ "data-sidebar-project-episodes-row": "" }}>
        <span aria-hidden="true" className={cn("grid shrink-0 place-items-center text-ink-secondary", simple ? "size-[22px]" : "size-5")}>
          <Clapperboard size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink">{t("sidebarEpisodes.title")}</span>
      </Disclosure>
      <div id={listId} role="group" aria-label={t("sidebarEpisodes.title")} hidden={!open} className={cn("flex flex-col", gap)}>
        {open && episodes.map((episode) => (
          <EpisodeRows key={episode.number} project={project} episode={episode} simple={simple} gap={gap} locale={locale}
            openHere={episode.bots.some((bot) => bot.id === openChat) ? openChat : null} onOpenBot={openBot} />
        ))}
      </div>
    </div>
  );
}

interface EpisodeRowsProps {
  project: EpisodesOf;
  episode: EpisodeTeam<Bot>;
  simple: boolean;
  gap: string;
  /** Drawn again in a new language. */
  locale: string;
  /** The conversation open in the chat view, while it is one of this episode's. */
  openHere: string | null;
  onOpenBot: (bot: Bot) => void;
}

const sameRows = (before: EpisodeRowsProps, after: EpisodeRowsProps) =>
  before.project === after.project && before.simple === after.simple && before.gap === after.gap && before.locale === after.locale
  && before.openHere === after.openHere && before.onOpenBot === after.onOpenBot && before.episode.number === after.episode.number
  && before.episode.bots.length === after.episode.bots.length && before.episode.bots.every((bot, at) => bot === after.episode.bots[at]);

/** One episode: its row and, unfolded, its bots with their role after their name, their job's name when they have none. */
const EpisodeRows = memo(function EpisodeRows({ project, episode, simple, gap, openHere, onOpenBot }: EpisodeRowsProps) {
  const [open, setOpen] = useRememberedDisclosure(`project-episode:${project.id}:${episode.number}`);
  const botsId = useId();
  const code = episodeCode(episode.number);
  const jobOf = (bot: Bot) => project.episodeBots[bot.id]?.job;
  return (
    <div className={cn("flex flex-col", gap)}>
      <Disclosure open={open} controls={botsId} simple={simple} depth={1} bots={episode.bots} openChat={openHere} onToggle={() => setOpen(!open)}
        data={{ "data-sidebar-project-episode-row": String(episode.number) }}>
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5 tabular-nums text-ink">{code}</span>
      </Disclosure>
      <div id={botsId} role="group" aria-label={code} hidden={!open} className={cn("flex flex-col", gap)}>
        {open && episode.bots.map((bot) => {
          const job = jobOf(bot);
          return (
            <SidebarProjectBot key={bot.id} bot={bot} role={bot.title.trim() || (job ? t(JOB_NAMES[job]) : "")} depth={2} simple={simple}
              selected={openHere === bot.id} onOpen={() => onOpenBot(bot)} />
          );
        })}
      </div>
    </div>
  );
}, sameRows);

/** A row that folds what is under it: marked, while folded, with what goes on among `bots` and with the conversation open
 * among them. */
function Disclosure({ open, controls, simple, depth, bots, openChat, onToggle, data, children }: {
  open: boolean;
  controls: string;
  simple: boolean;
  depth: 0 | 1;
  bots: Bot[];
  openChat: string | null;
  onToggle: () => void;
  data: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  const selected = !open && openChat !== null && bots.some((bot) => bot.id === openChat);
  const attention = open ? null : sidebarSectionAttention(bots, []);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button type="button" {...data} aria-expanded={open} aria-controls={controls} aria-current={selected ? "page" : undefined} onClick={onToggle}
      className={underProjectRow(simple, depth, selected)}>
      {children}
      {attention && <SectionAttention attention={attention} label={sidebarAttentionLabel(attention)} />}
      <Chevron size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary", !open && "rtl:-scale-x-100")} />
    </button>
  );
}
