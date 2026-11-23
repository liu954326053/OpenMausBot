import { memo, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Crown, Film, PanelRightClose, PanelRightOpen } from "lucide-react";
import { episodeCode } from "../../../../shared/production";
import type { CanvasBotState, CanvasFileRef } from "../../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import type { LocaleKey } from "@/locales";
import type { BoardAsset, BoardIndex, EpisodeRow } from "./board-index";
import { BotFace, BotStatus, EmptyLine, NO_LOOK, PANEL_ROW, ROW_META, RowGroup } from "./panel-parts";

const TABS = ["team", "assets", "episodes"] as const;
type Tab = (typeof TABS)[number];
const TAB_KEYS: Record<Tab, LocaleKey> = { team: "boardPanels.tab.team", assets: "boardPanels.tab.assets", episodes: "boardPanels.tab.episodes" };

const EPISODE_STATUS_KEYS: Record<NonNullable<EpisodeRow["status"]>, LocaleKey> = {
  waiting: "boardPanels.episodeStatus.waiting",
  storyboard: "boardPanels.episodeStatus.storyboard",
  videos: "boardPanels.episodeStatus.videos",
  post: "boardPanels.episodeStatus.post",
  done: "boardPanels.episodeStatus.done",
  failed: "boardPanels.episodeStatus.failed",
};

/** The panel's width with the gap to the layer's edge: what a chat window keeps clear of. */
export const SIDE_PANEL_ROOM = 288 + 16;

const FLOATING = "popover-surface pointer-events-auto absolute end-4 top-4 rounded-xl border border-hairline/50 bg-menu";

export interface SidePanelProps {
  index: BoardIndex;
  looks: Record<string, CanvasBotLook>;
  pictureUrl(file: CanvasFileRef): string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The bot whose chat window is open. */
  chatBotId?: string;
  onBot(botId: string): void;
  onAsset(asset: BoardAsset): void;
  onEpisode(episode: number): void;
}

export function SidePanel({ index, looks, pictureUrl, open, onOpenChange, chatBotId, onBot, onAsset, onEpisode }: SidePanelProps) {
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
            {tab === "team" ? <TeamTab team={index.team} looks={looks} chatBotId={chatBotId} onBot={onBot} /> : null}
            {tab === "assets" ? <AssetsTab index={index} pictureUrl={pictureUrl} onAsset={onAsset} /> : null}
            {tab === "episodes" ? <EpisodesTab episodes={index.episodes} onEpisode={onEpisode} /> : null}
          </div>
        ) : null}
      </aside>
    </>
  );
}

function TeamTab({ team, looks, chatBotId, onBot }: { team: BoardIndex["team"]; looks: Record<string, CanvasBotLook>; chatBotId?: string; onBot(botId: string): void }) {
  const row = (bot: CanvasBotState) => (
    <TeamRow key={bot.botId} botId={bot.botId} name={bot.name} title={bot.title} status={bot.status} lead={bot.lead} look={looks[bot.botId] ?? NO_LOOK} active={bot.botId === chatBotId} onBot={onBot} />
  );
  if (!team.episodes.length) return <RowGroup>{team.drama.map(row)}</RowGroup>;
  return (
    <>
      <RowGroup label={t("boardPanels.team.drama")}>{team.drama.map(row)}</RowGroup>
      <RowGroup label={t("boardPanels.team.eachEpisode")}>{team.episodes.map(row)}</RowGroup>
    </>
  );
}

interface TeamRowProps {
  botId: string;
  name: string;
  title: string;
  status: CanvasBotState["status"];
  lead: boolean;
  look: CanvasBotLook;
  active: boolean;
  onBot(botId: string): void;
}

const TeamRow = memo(function TeamRow({ botId, name, title, status, lead, look, active, onBot }: TeamRowProps) {
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

function AssetsTab({ index, pictureUrl, onAsset }: { index: BoardIndex; pictureUrl(file: CanvasFileRef): string; onAsset(asset: BoardAsset): void }) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(() => new Set());
  const { characters, scenes, shotsByEpisode, finals } = index;
  if (!characters.length && !scenes.length && !shotsByEpisode.length && !finals.length) return <EmptyLine text={t("boardPanels.assets.empty")} />;
  const titles = new Map(index.episodes.map((row) => [row.episode, row.title]));
  const toggle = (episode: number) => setUnfolded((current) => {
    const next = new Set(current);
    if (!next.delete(episode)) next.add(episode);
    return next;
  });
  const profileRow = (asset: BoardAsset) => {
    const file = asset.media?.metadata?.file;
    return (
      <AssetRow key={asset.cardId} asset={asset} meta={asset.node.metadata?.card?.subtitle} onAsset={onAsset}>
        {file ? <img src={pictureUrl(file)} alt="" loading="lazy" className="size-7 shrink-0 rounded-md bg-inset object-cover" /> : <span aria-hidden="true" className="size-7 shrink-0 rounded-md bg-ink/[0.06]" />}
      </AssetRow>
    );
  };
  return (
    <>
      {characters.length ? <RowGroup label={t("boardPanels.assets.characters")} count={characters.length}>{characters.map(profileRow)}</RowGroup> : null}
      {scenes.length ? <RowGroup label={t("boardPanels.assets.scenes")} count={scenes.length}>{scenes.map(profileRow)}</RowGroup> : null}
      {shotsByEpisode.length ? (
        <RowGroup label={t("boardPanels.assets.shots")} count={shotsByEpisode.reduce((total, group) => total + group.shots.length, 0)}>
          {shotsByEpisode.map((group) => (
            <EpisodeShots key={group.episode} episode={group.episode} title={titles.get(group.episode) ?? ""} shots={group.shots} open={unfolded.has(group.episode)} onToggle={toggle} onAsset={onAsset} />
          ))}
        </RowGroup>
      ) : null}
      {finals.length ? (
        <RowGroup label={t("boardPanels.assets.finals")} count={finals.length}>
          {finals.map((asset) => (
            <AssetRow key={asset.cardId} asset={asset} meta={episodeCode(asset.episode!)} onAsset={onAsset}>
              <Film size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            </AssetRow>
          ))}
        </RowGroup>
      ) : null}
    </>
  );
}

function AssetRow({ asset, meta, onAsset, children }: { asset: BoardAsset; meta?: string; onAsset(asset: BoardAsset): void; children: ReactNode }) {
  return (
    <li>
      <button type="button" className={PANEL_ROW} onClick={() => onAsset(asset)}>
        {children}
        <span className="min-w-0 flex-1">
          <span title={asset.title} className="block truncate text-[13px] leading-[18px] text-ink">{asset.title}</span>
          {meta ? <span title={meta} className={ROW_META}>{meta}</span> : null}
        </span>
      </button>
    </li>
  );
}

interface EpisodeShotsProps {
  episode: number;
  title: string;
  shots: BoardAsset[];
  open: boolean;
  onToggle(episode: number): void;
  onAsset(asset: BoardAsset): void;
}

function EpisodeShots({ episode, title, shots, open, onToggle, onAsset }: EpisodeShotsProps) {
  const listId = useId();
  return (
    <li>
      <button type="button" className={PANEL_ROW} aria-expanded={open} aria-controls={listId} onClick={() => onToggle(episode)}>
        <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-[120ms] motion-reduce:transition-none rtl:-scale-x-100", open && "rotate-90 rtl:-rotate-90")} />
        <span className="shrink-0 text-[12px] font-medium leading-4 tabular-nums text-ink-secondary">{episodeCode(episode)}</span>
        <span title={title} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{title}</span>
        <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{shots.length}</span>
      </button>
      <ul id={listId} hidden={!open} className="flex flex-col">
        {open ? shots.map((shot) => {
          const seconds = shot.node.metadata?.settings?.seconds;
          return (
            <li key={shot.cardId}>
              <button type="button" className={cn(PANEL_ROW, "ps-8")} onClick={() => onAsset(shot)}>
                <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{shot.code}</span>
                <span title={shot.title} className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{shot.title}</span>
                {seconds ? <span className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-tertiary">{t("boardPanels.fact.seconds", { count: seconds })}</span> : null}
              </button>
            </li>
          );
        }) : null}
      </ul>
    </li>
  );
}

function EpisodesTab({ episodes, onEpisode }: { episodes: readonly EpisodeRow[]; onEpisode(episode: number): void }) {
  if (!episodes.length) return <EmptyLine text={t("boardPanels.episodes.empty")} />;
  return (
    <RowGroup>
      {episodes.map((row) => {
        const progress = row.shots ? t("boardPanels.episodes.ready", { ready: row.ready, shots: row.shots }) : t("boardPanels.episodes.noShots");
        const meta = row.status ? `${t(EPISODE_STATUS_KEYS[row.status])} · ${progress}` : progress;
        return (
          <li key={row.episode}>
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
      })}
    </RowGroup>
  );
}
