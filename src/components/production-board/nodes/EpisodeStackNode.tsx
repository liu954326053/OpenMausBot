import { Fragment } from "react";
import { episodeCode, type ProductionEpisodeStatus } from "../../../../shared/production";
import { t } from "@/lib/i18n";
import type { BoardStackCard } from "@/lib/production-board/types";
import { ScriptHoles, type NodeContext } from "./parts";

const LISTED_FIRST = 3;

const SUMMED: ReadonlyArray<{ key: "done" | "working" | "waiting" | "failed"; of: readonly ProductionEpisodeStatus[] }> = [
  { key: "done", of: ["done"] },
  { key: "working", of: ["storyboard", "videos", "post"] },
  { key: "waiting", of: ["waiting"] },
  { key: "failed", of: ["failed"] },
];

export function EpisodeStackNode({ card, ctx }: { card: BoardStackCard; ctx: NodeContext }) {
  const { episodes } = card;
  const first = episodes[0]!;
  const last = episodes.at(-1)!;
  const listed = episodes.length > LISTED_FIRST + 1 ? [...episodes.slice(0, LISTED_FIRST), last] : episodes;
  const sums = SUMMED.map((sum) => ({ key: sum.key, count: episodes.filter((one) => one.status && sum.of.includes(one.status)).length })).filter((sum) => sum.count > 0);
  const open = () => ctx.actions.openStack();
  return (
    <>
      <ScriptHoles />
      <header className="pp-head" onClick={open}>
        <span className="mono ep-no">{`${episodeCode(first.episode)} – ${episodeCode(last.episode)}`}</span>
        <h3>{t("boardCards.stack.more", { count: episodes.length })}</h3>
      </header>
      <ol className="epm" onClick={open}>
        {listed.map((one, index) => (
          <Fragment key={one.episode}>
            {index > 0 && one.episode > listed[index - 1]!.episode + 1 ? <li className="epm-gap" aria-hidden="true">···</li> : null}
            <li>
              <span className="mono">{episodeCode(one.episode)}</span>
              {one.title}
            </li>
          </Fragment>
        ))}
      </ol>
      <footer className="pp-foot">
        {sums.map((sum) => <span key={sum.key}>{t(`boardCards.stack.${sum.key}`, { count: sum.count })}</span>)}
      </footer>
    </>
  );
}
