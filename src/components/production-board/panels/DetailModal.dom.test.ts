// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { boardIndex } from "@/lib/production-board/board-index";
import { detailsLinks, detailsView, type DetailsView } from "@/lib/production-board/details-view";
import type { BoardCard } from "@/lib/production-board/types";
import { boardFixture } from "../testing/board-fixture";
import { buttonNamed, click, press, render, textOf, useBoardPage } from "../testing/dom-kit";
import { DetailModal } from "./DetailModal";

useBoardPage();

const manyTakes = (card: BoardCard) => card.kind === "result" && card.takes.length > 1;

type Options = {
  readOnly?: boolean;
  where?: (card: BoardCard) => boolean;
  edit?: (view: DetailsView) => DetailsView;
};

function open(kind: "character" | "brief" | "result", { readOnly = false, where = () => true, edit = (view: DetailsView) => view }: Options = {}) {
  const fixture = boardFixture();
  const card = fixture.cardOf(kind, where);
  const index = boardIndex(fixture.snapshot);
  const asset = index.assetOf(card.nodeIds[0]!)!;
  const view = edit(detailsView(asset, index, fixture.snapshot.bots[index.ownerOf(asset)], fixture.snapshot.drafts, fixture.ctx.fileUrl));
  const calls = { onClose: vi.fn(), onLocate: vi.fn(), onAsk: vi.fn(), onOpenCard: vi.fn(), onSelectTake: vi.fn() };
  const links = detailsLinks(card.id, fixture.board, (id) => id);
  const root = render(createElement("div", { className: "mj-board" }, createElement(DetailModal, { view, links, card, ctx: fixture.ctx, readOnly, ...calls })));
  return { box: root.querySelector<HTMLElement>(".dm-box")!, scrim: root.querySelector<HTMLElement>(".dm-scrim")!, view, card, links, calls };
}

describe("a card's details", () => {
  it("are the mockup's modal: what it is and its title, its picture on the left, what is known of it on the right", () => {
    const { box, view } = open("character");
    expect(box.getAttribute("role")).toBe("dialog");
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(box.dataset.boardAsset).toBe("character");
    expect(box.dataset.kind).toBe("char");
    expect(textOf(box.querySelector(".dm-head h2"))).toBe(view.title);
    expect(box.querySelector(".dm-body .dm-media .dm-art img")).not.toBeNull();
    expect(box.querySelectorAll(".dm-info .dm-sec").length).toBeGreaterThan(0);
    expect(box.querySelector(".dm-uses, .dm-none")).not.toBeNull();
  });

  it("shows a document as the sheet the board shows, standing still", () => {
    const { box } = open("brief");
    expect(box.querySelector(".dm-media .node.k-brief.dm-card")).not.toBeNull();
  });

  it("lists a video's takes, the one the film uses marked", () => {
    const { box, view } = open("result");
    expect(box.querySelectorAll(".dm-takes .take")).toHaveLength(view.takes.length);
    expect(box.querySelector(".dm-takes .take[data-cur]")).not.toBeNull();
  });

  it("locates the card, asks the bot it belongs to, and closes on its button, its scrim and Escape", () => {
    const { box, scrim, calls, view } = open("character");
    click(buttonNamed(box, "Show on the board"));
    expect(calls.onLocate).toHaveBeenCalledTimes(1);
    click(box.querySelector(".dm-foot .btn-primary"));
    expect(calls.onAsk).toHaveBeenCalledTimes(1);
    expect(textOf(box.querySelector(".dm-foot .btn-primary"))).toContain(view.owner!.name);
    click(box.querySelector(".dm-head .dm-close"));
    click(scrim);
    press(box, "Escape");
    expect(calls.onClose).toHaveBeenCalledTimes(3);
  });

  it("picks another take by its node, and leaves the one the film uses alone", () => {
    const { box, card, calls } = open("result", { where: manyTakes });
    const takes = [...box.querySelectorAll<HTMLButtonElement>(".dm-takes .take")];
    const other = takes.findIndex((take) => !take.hasAttribute("data-cur"));
    click(takes.find((take) => take.hasAttribute("data-cur")));
    click(takes[other]);
    expect(calls.onSelectTake.mock.calls).toEqual([[card.kind === "result" && card.takes[other]!.nodeId]]);
  });

  it("read only, offers no bot to ask and no take to pick", () => {
    const { box } = open("result", { readOnly: true, where: manyTakes });
    expect(box.querySelector(".dm-foot .btn-primary")).toBeNull();
    expect([...box.querySelectorAll<HTMLButtonElement>(".dm-takes .take")].every((take) => take.disabled)).toBe(true);
  });

  it("opens the card at the other end of a line, named for the line", () => {
    const { box, links, calls } = open("brief");
    const rels = [...box.querySelectorAll(".rels .rel")];
    expect(rels).toHaveLength(links.upstream.length + links.downstream.length);
    expect(textOf(rels[0]!.querySelector("em"))).toBe("Output");
    click(rels[0]);
    expect(calls.onOpenCard).toHaveBeenCalledWith(links.upstream[0]);
  });

  it("opens a shot it is in", () => {
    const { box, calls } = open("character", { where: (card) => card.kind === "character" && card.appearsIn.length > 0 });
    click(box.querySelector(".dm-uses .use"));
    expect(calls.onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ cardKind: "shot", kind: "ref" }));
  });

  it("takes the focus to its close button, and gives it back when it goes", () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    const { box } = open("character");
    expect(document.activeElement).toBe(box.querySelector(".dm-close"));
    render(createElement("div"));
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});
