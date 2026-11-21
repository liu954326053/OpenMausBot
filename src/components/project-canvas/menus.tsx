// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-context-menu.tsx and
// canvas-create-menu.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardPaste, Copy, CopyPlus, Group, Network, PanelBottomOpen, SquareDashedMousePointer, Trash2, Ungroup, Upload } from "lucide-react";
import type { CanvasPoint } from "../../../shared/project-canvas";
import { MENU_ITEM, MENU_ITEM_SEPARATOR, MENU_SHEET } from "@/components/menu-recipe";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CreatableNodeType } from "./canvas-ui";
import { CREATABLE_TYPES } from "./docks";
import { addNodeLabel, NODE_ICONS, nodeTypeLabel } from "./node-kinds";

/** A menu at a point on the canvas, kept inside it. */
function PointMenu({ at, label, onClose, children }: { at: CanvasPoint; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  usePopoverDismiss(true, ref, onClose);
  useLayoutEffect(() => {
    const menu = ref.current;
    const host = menu?.offsetParent as HTMLElement | null;
    if (!menu || !host) return;
    setPlace({ x: Math.max(8, Math.min(at.x, host.clientWidth - menu.offsetWidth - 8)), y: Math.max(8, Math.min(at.y, host.clientHeight - menu.offsetHeight - 8)) });
  }, [at]);
  return (
    <div ref={ref} role="menu" aria-label={label} className={cn(MENU_SHEET, "absolute z-[90] w-56")} style={{ left: place.x, top: place.y }}>
      {children}
    </div>
  );
}

function MenuButton({ icon, label, onClick, disabled, danger }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} className={cn(MENU_ITEM, "hover:bg-menu-hover disabled:opacity-40", danger && "text-danger")} onClick={onClick}>
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function CreateMenu({ at, withConnection, onPick, onUpload, onClose }: { at: CanvasPoint; withConnection: boolean; onPick: (type: CreatableNodeType) => void; onUpload: () => void; onClose: () => void }) {
  return (
    <PointMenu at={at} label={t("projectCanvas.menu.create")} onClose={onClose}>
      {CREATABLE_TYPES.filter((type) => !withConnection || type !== "group").map((type) => {
        const Icon = NODE_ICONS[type];
        return <MenuButton key={type} icon={<Icon size={16} aria-hidden="true" />} label={nodeTypeLabel(type)} onClick={() => onPick(type)} />;
      })}
      {!withConnection ? (
        <>
          <div className={MENU_ITEM_SEPARATOR} />
          <MenuButton icon={<Upload size={16} aria-hidden="true" />} label={t("projectCanvas.toolbar.upload")} onClick={onUpload} />
        </>
      ) : null}
    </PointMenu>
  );
}

export interface NodeMenuActions {
  openPanel?: () => void;
  duplicate?: () => void;
  copy?: () => void;
  group?: () => void;
  ungroup?: () => void;
  remove?: () => void;
}

export interface CanvasMenuActions {
  paste?: () => void;
  selectAll: () => void;
  tidy?: () => void;
  create?: (type: CreatableNodeType) => void;
}

export function NodeContextMenu({ at, actions, onClose }: { at: CanvasPoint; actions: NodeMenuActions; onClose: () => void }) {
  const run = (action?: () => void) => () => {
    action?.();
    onClose();
  };
  return (
    <PointMenu at={at} label={t("projectCanvas.menu.node")} onClose={onClose}>
      {actions.openPanel ? <MenuButton icon={<PanelBottomOpen size={16} aria-hidden="true" />} label={t("projectCanvas.menu.openPanel")} onClick={run(actions.openPanel)} /> : null}
      <MenuButton icon={<CopyPlus size={16} aria-hidden="true" />} label={t("projectCanvas.shortcuts.duplicate")} disabled={!actions.duplicate} onClick={run(actions.duplicate)} />
      <MenuButton icon={<Copy size={16} aria-hidden="true" />} label={t("projectCanvas.shortcuts.copy")} disabled={!actions.copy} onClick={run(actions.copy)} />
      <MenuButton icon={<Group size={16} aria-hidden="true" />} label={t("projectCanvas.shortcuts.group")} disabled={!actions.group} onClick={run(actions.group)} />
      <MenuButton icon={<Ungroup size={16} aria-hidden="true" />} label={t("projectCanvas.shortcuts.ungroup")} disabled={!actions.ungroup} onClick={run(actions.ungroup)} />
      <div className={MENU_ITEM_SEPARATOR} />
      <MenuButton icon={<Trash2 size={16} aria-hidden="true" />} label={t("projectCanvas.toolbar.delete")} disabled={!actions.remove} danger={Boolean(actions.remove)} onClick={run(actions.remove)} />
    </PointMenu>
  );
}

export function CanvasContextMenu({ at, actions, onClose }: { at: CanvasPoint; actions: CanvasMenuActions; onClose: () => void }) {
  const run = (action?: () => void) => () => {
    action?.();
    onClose();
  };
  return (
    <PointMenu at={at} label={t("projectCanvas.menu.canvas")} onClose={onClose}>
      <MenuButton icon={<ClipboardPaste size={16} aria-hidden="true" />} label={t("projectCanvas.shortcuts.paste")} disabled={!actions.paste} onClick={run(actions.paste)} />
      <MenuButton icon={<SquareDashedMousePointer size={16} aria-hidden="true" />} label={t("projectCanvas.shortcuts.selectAll")} onClick={run(actions.selectAll)} />
      <MenuButton icon={<Network size={16} aria-hidden="true" />} label={t("projectCanvas.tidy")} disabled={!actions.tidy} onClick={run(actions.tidy)} />
      {actions.create ? (
        <>
          <div className={MENU_ITEM_SEPARATOR} />
          {CREATABLE_TYPES.map((type) => {
            const Icon = NODE_ICONS[type];
            return <MenuButton key={type} icon={<Icon size={16} aria-hidden="true" />} label={addNodeLabel(type)} onClick={run(() => actions.create?.(type))} />;
          })}
        </>
      ) : null}
    </PointMenu>
  );
}
