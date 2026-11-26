import { useEffectEvent, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { BoardCard } from "@/lib/production-board/types";
import type { Rect } from "../engine/camera";

export interface NodeFrameProps {
  card: BoardCard;
  rect: Rect;
  /** The mockup's class: "k-bot", "k-brief", … */
  kind: string;
  label: string;
  state?: string;
  vstate?: string;
  selected?: boolean;
  related?: boolean;
  dragging?: boolean;
  /** Not yet shown: the mockup's entrance starts from its "pre" class. */
  entering?: boolean;
  /** Called with the card's drawn height once it has one, and again each time it changes. */
  onHeight(cardId: string, height: number): void;
  children: ReactNode;
}

export function NodeFrame({ card, rect, kind, label, state, vstate, selected, related, dragging, entering, onHeight, children }: NodeFrameProps) {
  const element = useRef<HTMLElement>(null);
  const reported = useRef(0);
  const measure = useEffectEvent(() => {
    const height = element.current?.offsetHeight ?? 0;
    // A height of 0 means nothing lays the page out, as in a test's document.
    if (height === 0 || height === reported.current) return;
    reported.current = height;
    onHeight(card.id, height);
  });
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <article
      ref={element}
      className={cn("node", kind, selected && "is-sel", related && "is-rel", dragging && "is-drag", entering && "pre")}
      data-id={card.id}
      data-board-card-id={card.id}
      data-board-card={card.kind}
      data-state={state}
      data-vstate={vstate}
      tabIndex={0}
      aria-label={label}
      style={{ left: rect.x, top: rect.y, width: rect.w }}
    >
      {children}
    </article>
  );
}
