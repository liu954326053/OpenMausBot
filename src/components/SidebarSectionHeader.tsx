import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { memo, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  sidebarAttentionLabel,
  type SidebarSectionAttention,
} from "@/lib/sidebar-attention";

export function SidebarSectionHeader({
  name,
  collapsed,
  attention,
  alert,
  onToggle,
  reorderable: canReorder,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onDelete,
  onShare,
  onContextMenu,
  line = false,
  onMenu,
  menuLabel,
  reserveMenu = false,
  menuOpen = false,
}: {
  name: string;
  collapsed: boolean;
  attention?: SidebarSectionAttention;
  alert?: boolean;
  onToggle?: () => void;
  reorderable: boolean;
  dragging: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onDelete?: () => void;
  onShare?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  line?: boolean;
  onMenu?: (button: HTMLButtonElement) => void;
  /** What the ⋯ button is called when the heading is not a department's. */
  menuLabel?: string;
  /** Keep the ⋯ button's space when this line has none, so chevrons line up with lines that do (Simple). */
  reserveMenu?: boolean;
  menuOpen?: boolean;
}) {
  const reorderable = canReorder;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const attentionLabel = attention ? sidebarAttentionLabel(attention) : "";
  const alertLabel = alert ? t("computer.routines.needsYou") : undefined;
  const onHeaderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!reorderable || !event.altKey) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove?.(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove?.(1);
    }
  };
  const toggleTitle = reorderable
    ? collapsed
      ? t("sidebar.section.expandReorder", { name })
      : t("sidebar.section.collapseReorder", { name })
    : collapsed
      ? t("sidebar.section.expand", { name })
      : t("sidebar.section.collapse", { name });

  const menuName = menuLabel ?? t("team.actions", { name });

  if (line) {
    const tail = onToggle && (
      <Chevron size={14} aria-hidden="true" className="shrink-0 text-ink-secondary opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100 touch:opacity-100" />
    );
    return (
      <div
        data-section={name}
        data-sidebar-section-line=""
        tabIndex={onContextMenu ? -1 : undefined}
        onContextMenu={onContextMenu}
        draggable={reorderable || undefined}
        onDragStart={reorderable ? onDragStart : undefined}
        onDragEnd={reorderable ? onDragEnd : undefined}
        className={cn("group/section flex h-[30px] items-center gap-1.5 rounded-[6px] px-2 pb-1.5 pt-2 hover:bg-raised/50", reorderable && "cursor-grab", dragging && "opacity-40")}
      >
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            onKeyDown={onHeaderKeyDown}
            aria-expanded={!collapsed}
            aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
            title={toggleTitle}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink-secondary">{name}</span>
            {collapsed && <SectionAttention attention={attention} label={attentionLabel} alertLabel={alertLabel} />}
            {tail}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink-secondary">{name}</span>
            {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
            {tail}
          </div>
        )}
        {onMenu && (
          <button
            type="button"
            aria-label={menuName}
            title={menuName}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => onMenu(event.currentTarget)}
            className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-tertiary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus group-hover/section:opacity-100 group-focus-within/section:opacity-100 aria-expanded:bg-raised aria-expanded:text-ink aria-expanded:opacity-100 touch:opacity-100"
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
        )}
        {!onMenu && reserveMenu && <span aria-hidden="true" className="w-6 shrink-0" />}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-md px-2 pb-1" data-section={name} tabIndex={onContextMenu ? -1 : undefined} onContextMenu={onContextMenu}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          onKeyDown={onHeaderKeyDown}
          aria-expanded={!collapsed}
          aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          title={toggleTitle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-raised/50"
        >
          <span className="truncate text-[12px] font-semibold text-ink-secondary">
            {name}
          </span>
          <Chevron size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <SectionAttention attention={attention} label={attentionLabel} alertLabel={alertLabel} />
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5">
          <span className="truncate text-[12px] font-semibold text-ink-secondary">
            {name}
          </span>
          {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
        </div>
      )}
      {onMenu && (
        <button
          type="button"
          aria-label={menuName}
          title={menuName}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => onMenu(event.currentTarget)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink aria-expanded:bg-raised aria-expanded:text-ink"
        >
          <MoreHorizontal size={13} aria-hidden="true" />
        </button>
      )}
      {onShare && (
        <button
          type="button"
          onClick={onShare}
          aria-label={t("template.shareDepartment", { name })}
          title={t("template.shareDepartment", { name })}
          className="flex size-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <Share2 size={13} aria-hidden="true" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("sidebar.section.deleteAria", { name })}
          title={t("sidebar.section.deleteAria", { name })}
          className="flex size-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
      {reorderable && (
        <span
          aria-hidden="true"
          draggable
          title={t("sidebar.section.dragToReorder")}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className={cn(
            "flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink",
            dragging && "opacity-40",
          )}
        >
          <GripVertical size={13} />
        </span>
      )}
    </div>
  );
}

type SectionMark = "waiting" | "unread" | "working";

const SECTION_MARK: Record<SectionMark, string> = {
  waiting: "size-2 bg-warning",
  unread: "size-2 bg-accent",
  working: "size-1.5 animate-pulse bg-success motion-reduce:animate-none",
};

function sectionMark(attention: SidebarSectionAttention | undefined): SectionMark | null {
  if (!attention) return null;
  if (attention.waiting > 0) return "waiting";
  if (attention.unread > 0) return "unread";
  if (attention.working > 0) return "working";
  return null;
}

interface SectionAttentionProps {
  attention?: SidebarSectionAttention;
  label: string;
  /** Present while the section needs the person: said beside a red dot, which takes the place of the counts' mark. */
  alertLabel?: string;
}

const sameCounts = (a: SidebarSectionAttention | undefined, b: SidebarSectionAttention | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && (Object.keys(a) as (keyof SidebarSectionAttention)[]).every((key) => a[key] === b[key]));

const sameSectionAttention = (before: SectionAttentionProps, after: SectionAttentionProps): boolean =>
  before.label === after.label && before.alertLabel === after.alertLabel && sameCounts(before.attention, after.attention);

export const SectionAttention = memo(function SectionAttention({ attention, label, alertLabel }: SectionAttentionProps) {
  const mark = alertLabel ? null : sectionMark(attention);
  return (
    <>
      {mark && (
        <span aria-hidden="true" title={label} data-section-mark={mark} className="flex size-4 shrink-0 items-center justify-center">
          <span className={cn("rounded-full", SECTION_MARK[mark])} />
        </span>
      )}
      {label && <span className="sr-only">{label}</span>}
      {alertLabel && (
        <>
          <span data-testid="section-alert" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
          <span className="sr-only">{alertLabel}</span>
        </>
      )}
    </>
  );
}, sameSectionAttention);
