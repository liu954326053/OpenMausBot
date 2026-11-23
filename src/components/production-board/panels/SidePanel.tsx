import { memo, useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Crown, Film, PanelRightClose, PanelRightOpen } from "lucide-react";
import { episodeCode } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import type { LocaleKey } from "@/locales";
import { episodeStatus } from "../cards";
import { episodeProgress } from "./asset-words";
import type { EpisodeRow } from "./board-index";
import { BotFace, BotStatus, EmptyLine, NO_LOOK, PANEL_ROW, ROW_META, RowGroup } from "./panel-parts";
import type { AssetFacts, EpisodeShotsFacts, PanelRows, ShotFacts, TeamFacts } from "./panel-rows";

const TABS = ["team", "assets", "episodes"] as const;
type Tab = (typeof TABS)[number];
const TAB_KEYS: Record<Tab, LocaleKey> = { team: "boardPanels.tab.team", assets: "boardPanels.tab.assets", episodes: "boardPanels.tab.episodes" };

/** What a chat window keeps clear of at the layer's right edge: the gap to the edge, the open panel or its folded
 * button, and a gap beside it. */
export const SIDE_PANEL_ROOM = { open: 16 + 288 + 16, folded: 16 + 36 + 16 } as const;

const FLOATING = "popover-surface pointer-events-auto absolute end-4 top-4 rounded-xl border border-hairline/50 bg-menu";

export interface SidePanelProps {
  rows: PanelRows;
  looks: Record<string, CanvasBotLook>;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The bot whose chat window is open. */
  chatBotId?: string;
  onBot(botId: string): void;
  /** With the card id of the asset. */
  onAsset(cardId: string): void;
  onEpisode(episode: number): void;
  locale: string;
}

export const SidePanel = memo(function SidePanel({ rows, looks, open, onOpenChange, chatBotId, onBot, onAsset, onEpisode, locale }: SidePanelProps) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("team");
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const panelId = `${id}-panel`;
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = getComputedStyle(event.currentTarget).direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backward = forward === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
    const at = TABS.indexOf(tab);
    const moves: Record<string, number> = { [forward]: (at + 1) % TABS.length, [backward]: (at + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 };
    const next = TABS[moves[event.key] ?? -1];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };
  return (
    <>
      {open ? null : (
        <button
          type="button"
          className={cn(FLOATING, "ui-icon-button size-9")}
          aria-label={t("boardPanels.panel.show")}
          title={t("boardPanels.panel.show")}
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => onOpenChange(true)}
        >
          <PanelRightOpen size={16} aria-hidden="true" className="rtl:-scale-x-100" />
        </button>
      )}
      <aside
        id={panelId}
        data-board-side-panel=""
        hidden={!open}
        aria-label={t("boardPanels.panel.label")}
        className={cn(FLOATING, "flex max-h-[calc(100%-2rem)] w-72 flex-col gap-1 p-1.5 animate-pop-in motion-reduce:animate-none")}
      >
        <div className="flex items-center gap-1">
          <div role="tablist" aria-label={t("boardPanels.panel.label")} className="flex min-w-0 flex-1 gap-0.5 rounded-full bg-ink/[0.05] p-[3px]" onKeyDown={onTabKey}>
            {TABS.map((each) => (
              <button
                key={each}
                ref={(element) => {
                  if (element) tabRefs.current.set(each, element);
                  else tabRefs.current.delete(each);
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${each}`}
                aria-selected={each === tab}
                aria-controls={`${id}-tabpanel`}
                tabIndex={each === tab ? 0 : -1}
                className={cn(
                  "h-[26px] min-w-0 flex-1 truncate rounded-full px-2 text-[13px] leading-[18px] transition-colors duration-[120ms] motion-reduce:transition-none",
                  each === tab ? "bg-ink/[0.1] font-medium text-ink" : "text-ink-secondary hover:text-ink",
                )}
                onClick={() => setTab(each)}
              >
                {t(TAB_KEYS[each])}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ui-icon-button size-8 shrink-0"
            aria-label={t("boardPanels.panel.hide")}
            title={t("boardPanels.panel.hide")}
            aria-expanded={true}
            aria-controls={panelId}
            onClick={() => onOpenChange(false)}
          >
            <PanelRightClose size={16} aria-hidden="true" className="rtl:-scale-x-100" />
          </button>
        </div>
        {open ? (
          <div role="tabpanel" id={`${id}-tabpanel`} aria-labelledby={`${id}-tab-${tab}`} className="-mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5">
            {tab === "team" ? <TeamTab team={rows.team} looks={looks} chatBotId={chatBotId} onBot={onBot} locale={locale} /> : null}
            {tab === "assets" ? <AssetsTab characters={rows.characters} scenes={rows.scenes} shots={rows.shots} finals={rows.finals} onAsset={onAsset} locale={locale} /> : null}
            {tab === "episodes" ? <EpisodesTab episodes={rows.episodes} onEpisode={onEpisode} locale={locale} /> : null}
          </div>
        ) : null}
      </aside>
    </>
  );
});

interface TeamTabProps {
  team: PanelRows["team"];
  looks: Record<string, CanvasBotLook>;
  chatBotId?: string;
  onBot(botId: string): void;
  locale: string;
}

const TeamTab = memo(function TeamTab({ team, looks, chatBotId, onBot, locale }: TeamTabProps) {
  const row = (bot: TeamFacts) => (
    <TeamRow key={bot.botId} bot={bot} look={looks[bot.botId] ?? NO_LOOK} active={bot.botId === chatBotId} onBot={onBot} locale={locale} />
  );
  if (!team.episodes.length) return <RowGroup>{team.drama.map(row)}</RowGroup>;
  return (
    <>
      <RowGroup label={t("boardPanels.team.drama")}>{team.drama.map(row)}</RowGroup>
      <RowGroup label={t("boardPanels.team.eachEpisode")}>{team.episodes.map(row)}</RowGroup>
    </>
  );
});

interface TeamRowProps {
  bot: TeamFacts;
  look: CanvasBotLook;
  active: boolean;
  onBot(botId: string): void;
  locale: string;
}

const TeamRow = memo(function TeamRow({ bot: { botId, name, title, status, lead }, look, active, onBot }: TeamRowProps) {
  return (
    <li>
      <button type="button" data-team-row={botId} aria-current={active ? "true" : undefined} className={cn(PANEL_ROW, active && "bg-ink/[0.08]")} onClick={() => onBot(botId)}>
        <BotFace name={name} look={look} size={28} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span title={name} className="truncate text-[13px] font-medium leading-[18px] text-ink">{name}</span>
            {lead ? <Crown size={14} role="img" aria-label={t("boardPanels.team.lead")} className="shrink-0 text-ink-tertiary" /> : null}
          </span>
          {title ? <span title={title} className={ROW_META}>{title}</span> : null}
        </span>
        <BotStatus status={status} />
      </button>
    </li>
  );
});

interface AssetsTabProps {
  characters: readonly AssetFacts[];
  scenes: readonly AssetFacts[];
  shots: readonly EpisodeShotsFacts[];
  finals: readonly AssetFacts[];
  onAsset(cardId: string): void;
  locale: string;
}

const AssetsTab = memo(function AssetsTab({ characters, scenes, shots, finals, onAsset, locale }: AssetsTabProps) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = useCallback((episode: number) => setUnfolded((current) => {
    const next = new Set(current);
    if (!next.delete(episode)) next.add(episode);
    return next;
  }), []);
  if (!characters.length && !scenes.length && !shots.length && !finals.length) return <EmptyLine text={t("boardPanels.assets.empty")} />;
  return (
    <>
      {characters.length ? <RowGroup label={t("boardPanels.assets.characters")} count={characters.length}>{characters.map((asset) => <AssetRow key={asset.cardId} asset={asset} onAsset={onAsset} />)}</RowGroup> : null}
      {scenes.length ? <RowGroup label={t("boardPanels.assets.scenes")} count={scenes.length}>{scenes.map((asset) => <AssetRow key={asset.cardId} asset={asset} onAsset={onAsset} />)}</RowGroup> : null}
      {shots.length ? (
        <RowGroup label={t("boardPanels.assets.shots")} count={shots.reduce((total, group) => total + group.shots.length, 0)}>
          {shots.map((group) => (
            <EpisodeShots
              key={group.episode}
              episode={group.episode}
              title={group.title}
              count={group.shots.length}
              shots={unfolded.has(group.episode) ? group.shots : undefined}
              onToggle={toggle}
              onAsset={onAsset}
              locale={locale}
            />
          ))}
        </RowGroup>
      ) : null}
      {finals.length ? (
        <RowGroup label={t("boardPanels.assets.finals")} count={finals.length}>
          {finals.map((asset) => <AssetRow key={asset.cardId} asset={asset} film onAsset={onAsset} />)}
        </RowGroup>
      ) : null}
    </>
  );
});

const AssetRow = memo(function AssetRow({ asset, film = false, onAsset }: { asset: AssetFacts; film?: boolean; onAsset(cardId: string): void }) {
  const picture = asset.picture
    ? <img src={asset.picture} alt="" loading="lazy" className="size-7 shrink-0 rounded-md bg-inset object-cover" />
    : <span aria-hidden="true" className="size-7 shrink-0 rounded-md bg-ink/[0.06]" />;
  return (
    <li>
      <button type="button" className={PANEL_ROW} onClick={() => onAsset(asset.cardId)}>
        {film ? <Film size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" /> : picture}
        <span className="min-w-0 flex-1">
          <span title={asset.title} className="block truncate text-[13px] leading-[18px] text-ink">{asset.title}</span>
          {asset.meta ? <span title={asset.meta} className={ROW_META}>{asset.meta}</span> : null}
        </span>
      </button>
    </li>
  );
});

interface EpisodeShotsProps {
  episode: number;
  title: string;
  count: number;
  /** Given only while the episode is unfolded, as its rows show them. */
  shots: readonly ShotFacts[] | undefined;
  onToggle(episode: number): void;
  onAsset(cardId: string): void;
  locale: string;
}

const EpisodeShots = memo(function EpisodeShots({ episode, title, count, shots, onToggle, onAsset, locale }: EpisodeShotsProps) {
  const listId = useId();
  const open = shots !== undefined;
  return (
    <li>
      <button type="button" className={PANEL_ROW} aria-expanded={open} aria-controls={listId} onClick={() => onToggle(episode)}>
        <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-[120ms] motion-reduce:transition-none rtl:-scale-x-100", open && "rotate-90 rtl:-rotate-90")} />
        <span className="shrink-0 text-[12px] font-medium leading-4 tabular-nums text-ink-secondary">{episodeCode(episode)}</span>
        <span title={title} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{title}</span>
        <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{count}</span>
      </button>
      <ul id={listId} hidden={!open} className="flex flex-col">
        {shots?.map((shot) => <ShotRow key={shot.cardId} shot={shot} onAsset={onAsset} locale={locale} />)}
      </ul>
    </li>
  );
});

const ShotRow = memo(function ShotRow({ shot, onAsset }: { shot: ShotFacts; onAsset(cardId: string): void; locale: string }) {
  return (
    <li>
      <button type="button" className={cn(PANEL_ROW, "ps-8")} onClick={() => onAsset(shot.cardId)}>
        <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{shot.code}</span>
        <span title={shot.title} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{shot.title}</span>
        {shot.seconds ? <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{t("boardPanels.fact.seconds", { count: shot.seconds })}</span> : null}
      </button>
    </li>
  );
});

const EpisodesTab = memo(function EpisodesTab({ episodes, onEpisode, locale }: { episodes: readonly EpisodeRow[]; onEpisode(episode: number): void; locale: string }) {
  if (!episodes.length) return <EmptyLine text={t("boardPanels.episodes.empty")} />;
  return <RowGroup>{episodes.map((row) => <EpisodeLine key={row.episode} row={row} onEpisode={onEpisode} locale={locale} />)}</RowGroup>;
});

const EpisodeLine = memo(function EpisodeLine({ row, onEpisode }: { row: EpisodeRow; onEpisode(episode: number): void; locale: string }) {
  const progress = episodeProgress(row);
  const status = episodeStatus(row.status);
  const meta = status ? `${status.label} · ${progress}` : progress;
  return (
    <li>
      <button type="button" className={PANEL_ROW} onClick={() => onEpisode(row.episode)}>
        <span className="w-9 shrink-0 text-[12px] font-medium leading-4 tabular-nums text-ink-secondary">{episodeCode(row.episode)}</span>
        <span className="min-w-0 flex-1">
          {row.title ? <span title={row.title} className="block truncate text-[13px] leading-[18px] text-ink">{row.title}</span> : null}
          <span title={meta} className={ROW_META}>{meta}</span>
        </span>
        {row.status === "done" ? <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-success" /> : null}
        {row.status === "failed" ? <AlertCircle size={16} aria-hidden="true" className="shrink-0 text-danger" /> : null}
      </button>
    </li>
  );
});
