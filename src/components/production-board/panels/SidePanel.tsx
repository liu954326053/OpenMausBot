import { memo, useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronsDownUp, Film, PanelRight, PanelRightClose, Clapperboard, Mountain, Drama } from "lucide-react";
import { episodeCode } from "../../../../shared/production";
import type { CanvasBotState } from "../../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import type { LocaleKey } from "@/locales";
import { episodeProgress } from "@/lib/production-board/asset-words";
import type { EpisodeRow } from "@/lib/production-board/board-index";
import { botStatus } from "@/lib/production-board/status";
import type { AssetFacts, EpisodeShotsFacts, PanelRows, ShotFacts, TeamFacts } from "@/lib/production-board/panel-rows";
import { BotAvatar } from "@/components/Avatar";

const TABS = ["team", "assets", "episodes"] as const;
type Tab = (typeof TABS)[number];
const TAB_KEYS: Record<Tab, LocaleKey> = { team: "boardPanels.tab.team", assets: "boardPanels.tab.assets", episodes: "boardPanels.tab.episodes" };

/** The room the folded panel keeps at the board's right edge, and the open one beside it: the board reads the width off
 * the element carrying `data-board-room`, and the stage bar and the minimap stay clear of it. */
export const SIDE_PANEL_ROOM = { open: 304, folded: 56 } as const;

export interface SidePanelProps {
  rows: PanelRows;
  looks: Readonly<Record<string, CanvasBotLook>>;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The bot whose chat window is open. */
  chatBotId?: string;
  onBot(botId: string): void;
  /** With the card id of the asset. */
  onAsset(cardId: string): void;
  onEpisode(episode: number): void;
}

export const SidePanel = memo(function SidePanel({ rows, looks, open, onOpenChange, chatBotId, onBot, onAsset, onEpisode }: SidePanelProps) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("team");
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
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
      <div data-board-room="" aria-hidden="true" style={{ width: open ? SIDE_PANEL_ROOM.open : SIDE_PANEL_ROOM.folded }} />
      {open ? (
        <aside data-board-side-panel="" aria-label={t("boardPanels.panel.label")} className="side">
          <div className="pane-head">
            <div role="tablist" aria-label={t("boardPanels.panel.label")} className="flex min-w-0 flex-1 items-center" onKeyDown={onTabKey}>
              {TABS.map((each) => (
                <button
                  key={each}
                  ref={(element) => {
                    if (element) tabRefs.current.set(each, element);
                    else tabRefs.current.delete(each);
                  }}
                  type="button"
                  role="tab"
                  className="schip"
                  id={`${id}-tab-${each}`}
                  aria-selected={each === tab}
                  aria-controls={`${id}-pane`}
                  aria-current={each === tab ? "true" : undefined}
                  tabIndex={each === tab ? 0 : -1}
                  onClick={() => setTab(each)}
                >
                  {t(TAB_KEYS[each])}
                </button>
              ))}
            </div>
            <button type="button" className="tbtn" aria-label={t("boardPanels.panel.hide")} title={t("boardPanels.panel.hide")} aria-expanded={true} onClick={() => onOpenChange(false)}>
              <PanelRightClose size={16} aria-hidden="true" className="rtl:-scale-x-100" />
            </button>
          </div>
          <div role="tabpanel" id={`${id}-pane`} aria-labelledby={`${id}-tab-${tab}`} className="pane-scroll">
            {tab === "team" ? <TeamTab team={rows.team} looks={looks} chatBotId={chatBotId} onBot={onBot} /> : null}
            {tab === "assets" ? <AssetsTab characters={rows.characters} scenes={rows.scenes} shots={rows.shots} finals={rows.finals} onAsset={onAsset} /> : null}
            {tab === "episodes" ? <EpisodesTab episodes={rows.episodes} onEpisode={onEpisode} /> : null}
          </div>
        </aside>
      ) : (
        <div className="side-fold">
          <button type="button" className="tbtn" aria-label={t("boardPanels.panel.show")} title={t("boardPanels.panel.show")} aria-expanded={false} onClick={() => onOpenChange(true)}>
            <PanelRight size={16} aria-hidden="true" className="rtl:-scale-x-100" />
          </button>
        </div>
      )}
    </>
  );
});

function SectionLabel({ text, count }: { text: string; count?: number }) {
  return (
    <p className="sec-lbl">
      {text}
      {count === undefined ? null : <span className="cnt ms-1.5">{count}</span>}
    </p>
  );
}

/** The lines' four states, drawn as the board draws them. */
const LEGEND: ReadonlyArray<{ line: string; text: LocaleKey }> = [
  { line: "lg-done", text: "productionBoard.legend.done" },
  { line: "lg-active", text: "productionBoard.legend.active" },
  { line: "lg-wait", text: "productionBoard.legend.wait" },
  { line: "lg-ref", text: "productionBoard.legend.ref" },
];

function Legend() {
  return (
    <>
      <SectionLabel text={t("productionBoard.legend.title")} />
      <ul className="legend">
        {LEGEND.map(({ line, text }) => (
          <li key={line}>
            <svg viewBox="0 0 44 8" aria-hidden="true"><path d="M1 4H43" className={line} /></svg>
            <span>{t(text)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

interface TeamTabProps {
  team: PanelRows["team"];
  looks: Readonly<Record<string, CanvasBotLook>>;
  chatBotId?: string;
  onBot(botId: string): void;
}

const TeamTab = memo(function TeamTab({ team, looks, chatBotId, onBot }: TeamTabProps) {
  const row = (bot: TeamFacts) => <TeamRow key={bot.botId} bot={bot} look={looks[bot.botId]} current={bot.botId === chatBotId} onBot={onBot} />;
  return (
    <>
      {team.episodes.length ? (
        <>
          <SectionLabel text={t("boardPanels.team.drama")} />
          <RowList>{team.drama.map(row)}</RowList>
          <SectionLabel text={t("boardPanels.team.eachEpisode")} />
          <RowList>{team.episodes.map(row)}</RowList>
        </>
      ) : (
        <>
          <SectionLabel text={t("boardPanels.team.drama")} />
          <RowList>{team.drama.map(row)}</RowList>
        </>
      )}
      <Legend />
    </>
  );
});

function RowList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

const TeamRow = memo(function TeamRow({ bot, look, current, onBot }: { bot: TeamFacts; look: CanvasBotLook | undefined; current: boolean; onBot(botId: string): void }) {
  const status = botStatus({ status: bot.status });
  return (
    <button type="button" className={cn("rrow", current && "is-cur")} data-bot={bot.botId} data-state={toneOf(bot.status)} onClick={() => onBot(bot.botId)}>
      <span className="ava">
        <span aria-hidden="true" className="flex"><BotAvatar bot={{ name: bot.name, ...(look ?? { color: "silver" }) }} size={28} /></span>
      </span>
      <span className="who">
        <b>{bot.name}</b>
        <span>{bot.lead ? t("boardPanels.team.lead") : bot.title}</span>
      </span>
      <span className="st" data-state={toneOf(bot.status)}><i className="led" />{status.label}</span>
    </button>
  );
});

/** The tone the board gives a bot's work, as the stylesheet colours a row's avatar and light by. */
function toneOf(status: CanvasBotState["status"]): string {
  switch (status) {
    case "working": return "working";
    case "queued": return "active";
    case "error": return "failed";
    default: return "idle";
  }
}

interface AssetsTabProps {
  characters: readonly AssetFacts[];
  scenes: readonly AssetFacts[];
  shots: readonly EpisodeShotsFacts[];
  finals: readonly AssetFacts[];
  onAsset(cardId: string): void;
}

const KIND_ICON = { character: Drama, scene: Mountain, shot: Clapperboard, final: Film } as const;

const AssetsTab = memo(function AssetsTab({ characters, scenes, shots, finals, onAsset }: AssetsTabProps) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = useCallback((episode: number) => setUnfolded((current) => {
    const next = new Set(current);
    if (!next.delete(episode)) next.add(episode);
    return next;
  }), []);
  if (!characters.length && !scenes.length && !shots.length && !finals.length) return <p className="sec-lbl">{t("boardPanels.assets.empty")}</p>;
  return (
    <>
      {characters.length ? (
        <>
          <SectionLabel text={t("boardPanels.assets.characters")} count={characters.length} />
          <RowList>{characters.map((asset) => <AssetRow key={asset.cardId} asset={asset} icon={KIND_ICON.character} onAsset={onAsset} />)}</RowList>
        </>
      ) : null}
      {scenes.length ? (
        <>
          <SectionLabel text={t("boardPanels.assets.scenes")} count={scenes.length} />
          <RowList>{scenes.map((asset) => <AssetRow key={asset.cardId} asset={asset} icon={KIND_ICON.scene} onAsset={onAsset} />)}</RowList>
        </>
      ) : null}
      {shots.length ? (
        <>
          <SectionLabel text={t("boardPanels.assets.shots")} count={shots.reduce((total, group) => total + group.shots.length, 0)} />
          <RowList>
            {shots.map((group) => (
              <EpisodeShots key={group.episode} episode={group.episode} title={group.title} count={group.shots.length}
                shots={unfolded.has(group.episode) ? group.shots : undefined} onToggle={toggle} onAsset={onAsset} />
            ))}
          </RowList>
        </>
      ) : null}
      {finals.length ? (
        <>
          <SectionLabel text={t("boardPanels.assets.finals")} count={finals.length} />
          <RowList>{finals.map((asset) => <AssetRow key={asset.cardId} asset={asset} icon={KIND_ICON.final} onAsset={onAsset} />)}</RowList>
        </>
      ) : null}
    </>
  );
});

const AssetRow = memo(function AssetRow({ asset, icon: Icon, onAsset }: { asset: AssetFacts; icon: typeof Film; onAsset(cardId: string): void }) {
  return (
    <button type="button" className="rrow" data-card={asset.cardId} onClick={() => onAsset(asset.cardId)}>
      <span className="ava sm">
        {asset.picture ? <img src={asset.picture} alt="" loading="lazy" className="size-full rounded-[7px] object-cover" /> : <Icon size={14} aria-hidden="true" />}
      </span>
      <span className="who">
        <b>{asset.title}</b>
        {asset.meta ? <span>{asset.meta}</span> : null}
      </span>
    </button>
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
}

const EpisodeShots = memo(function EpisodeShots({ episode, title, count, shots, onToggle, onAsset }: EpisodeShotsProps) {
  const open = shots !== undefined;
  return (
    <>
      <button type="button" className="rrow" aria-expanded={open} onClick={() => onToggle(episode)}>
        <span className="ava sm"><ChevronsDownUp size={14} aria-hidden="true" className={cn("transition-transform duration-[120ms] motion-reduce:transition-none", open && "rotate-180")} /></span>
        <span className="who">
          <b>{title}</b>
          <span className="mono">{episodeCode(episode)}</span>
        </span>
        <span className="cnt">{count}</span>
      </button>
      {shots?.map((shot) => (
        <button key={shot.cardId} type="button" className="rrow ps-10" onClick={() => onAsset(shot.cardId)} data-card={shot.cardId}>
          <span className="mono text-ink-tertiary">{shot.code}</span>
          <span className="who"><b>{shot.title}</b>{shot.seconds ? <span>{t("boardPanels.fact.seconds", { count: shot.seconds })}</span> : null}</span>
        </button>
      ))}
    </>
  );
});

const EpisodesTab = memo(function EpisodesTab({ episodes, onEpisode }: { episodes: readonly EpisodeRow[]; onEpisode(episode: number): void }) {
  if (!episodes.length) return <p className="sec-lbl">{t("boardPanels.episodes.empty")}</p>;
  return (
    <RowList>
      {episodes.map((row) => (
        <button key={row.episode} type="button" className="rrow" data-episode={row.episode} onClick={() => onEpisode(row.episode)}>
          <span className="mono w-9 shrink-0">{episodeCode(row.episode)}</span>
          <span className="who">
            <b>{row.title}</b>
            <span>{episodeProgress(row)}</span>
          </span>
          {row.status ? <span className="st" data-state={row.status === "done" ? "done" : row.status === "failed" ? "failed" : "idle"}><i className="led" />{row.status === "done" ? t("productionBoard.stageState.done") : row.status === "failed" ? t("productionBoard.stageState.failed") : t("productionBoard.stageState.active")}</span> : null}
        </button>
      ))}
    </RowList>
  );
});
