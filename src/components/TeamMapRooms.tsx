import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, MessagesSquare, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import { opensRowMenuFromKey } from "@/lib/bulk-select";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PICKER_MARGIN, pickerPlacement } from "@/lib/picker-placement";
import { useStore, type Group } from "@/state/store";
import { useTeamProjectSide } from "@/state/team-projects";
import { ConfirmDialog } from "./ConfirmDialog";
import { roomDeleteCopy } from "./room-delete-copy";
import { NewRoomPanel } from "./SidebarNewRoomPanel";
import { RoomMenu, type RoomMenuAt } from "./TeamMapRoomMenu";

const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-[12px] hover:bg-control focus-visible:outline-2 focus-visible:outline-accent";
const roomButton = "flex w-full items-center gap-2 rounded-lg py-2.5 ps-3 pe-10 text-start text-[12px] focus-visible:outline-2 focus-visible:outline-accent";
const actionsButton = "absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-secondary transition-opacity hover:bg-ink/[0.06] hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent";
const revealed = "opacity-0 group-hover/room:opacity-100 group-focus-within/room:opacity-100 touch:opacity-100";

export function TeamMapRoomList({ rooms, menuFor, onOpen, onMenu, onNew }: {
  rooms: Pick<Group, "id" | "name" | "dm" | "unread">[];
  menuFor?: string;
  onOpen: (id: string) => void;
  onMenu: (menu: RoomMenuAt) => void;
  onNew: () => void;
}) {
  return <>
    {rooms.length === 0 && <p className="px-3 py-2.5 text-[12px] text-ink-secondary">{t("sidebarProjects.mapRoomsEmpty")}</p>}
    {rooms.map((room) => <div key={room.id} className="group/room relative rounded-lg hover:bg-control">
      <button data-team-map-room={room.id} className={roomButton} onClick={() => onOpen(room.id)}
        onContextMenu={(event) => { event.preventDefault(); onMenu({ groupId: room.id, x: event.clientX, y: event.clientY }); }}
        onKeyDown={(event) => {
          if (!opensRowMenuFromKey(event.key, event.shiftKey, false)) return;
          event.preventDefault();
          // The ContextMenu key's native event carries no useful coordinates.
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu({ groupId: room.id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }}>
        {room.dm ? <MessageCircle size={14} className="shrink-0 text-ink-secondary" /> : <MessagesSquare size={14} className="shrink-0 text-ink-secondary" />}
        <span className="min-w-0 flex-1 truncate">{room.name}</span>
        {room.unread && <span data-team-map-room-unread="" role="img" aria-label={t("task.unread")} className="size-2 shrink-0 rounded-full bg-accent" />}
      </button>
      <button type="button" data-team-map-room-actions={room.id} aria-label={t("sidebar.bot.actions", { name: room.name })} aria-haspopup="menu"
        aria-expanded={menuFor === room.id} className={cn(actionsButton, menuFor === room.id ? "opacity-100" : revealed)}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu({ groupId: room.id, x: rect.left, y: rect.bottom + 4 });
        }}>
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
    </div>)}
    <div className="my-1 h-px bg-hairline/50" />
    <button className={item} onClick={onNew}><Plus size={14} className="shrink-0 text-ink-secondary" />{t("sidebar.newChannel.title")}</button>
  </>;
}

const insideListOrItsMenus = (details: HTMLElement, next: EventTarget | null) =>
  details.contains(next as Node | null) || (next instanceof Element && next.closest("[data-room-menu], [role=alertdialog]") !== null);

const LIST_WIDTH = 256;
const LIST_TALLEST = 320;
const LIST_GAP = 8;

function placeList(details: HTMLElement, toggle: HTMLElement, list: HTMLElement) {
  const anchor = toggle.getBoundingClientRect();
  const frame = details.getBoundingClientRect();
  const edge = anchor.right - LIST_WIDTH >= PICKER_MARGIN ? "right" : "left";
  const { left, width } = pickerPlacement(anchor, { width: LIST_WIDTH, height: 0 }, { width: window.innerWidth, height: window.innerHeight }, { vertical: "below", edge });
  Object.assign(list.style, {
    left: `${left - frame.left}px`,
    top: `${anchor.bottom - frame.top + LIST_GAP}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(0, Math.min(LIST_TALLEST, window.innerHeight - anchor.bottom - LIST_GAP - PICKER_MARGIN))}px`,
  });
}

/** The group chats and bot chats outside projects: the sidebar lists only the projects' own. */
export function TeamMapRooms() {
  const { state, dispatch } = useStore();
  const rooms = useTeamProjectSide().rooms(state.groups);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<RoomMenuAt | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toggleRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const place = useCallback(() => {
    if (detailsRef.current && toggleRef.current && listRef.current) placeList(detailsRef.current, toggleRef.current, listRef.current);
  }, []);
  useEffect(() => {
    const onResize = () => { if (detailsRef.current?.open) place(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);
  const deleting = deletingId ? state.groups.find((group) => group.id === deletingId) : undefined;
  const unread = rooms.some((room) => room.unread);
  return <>
    <details ref={detailsRef} className="relative" onToggle={(event) => { if (event.currentTarget.open) place(); }} onBlur={(event) => { if (!insideListOrItsMenus(event.currentTarget, event.relatedTarget)) event.currentTarget.removeAttribute("open"); }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.currentTarget.removeAttribute("open"); event.currentTarget.querySelector("summary")?.focus(); }
    }}>
      <summary ref={toggleRef} data-team-map-rooms="" onClick={place} className="relative flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-[12px] font-medium hover:bg-control [&::-webkit-details-marker]:hidden">
        <MessagesSquare size={14} />{t("sidebar.section.channels")}
        <span className="tabular-nums text-ink-secondary">{rooms.length}</span>
        {unread && <span data-team-map-rooms-unread="" role="img" aria-label={t("task.unread")} className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-app" />}
      </summary>
      <div ref={listRef} data-team-map-rooms-list="" className="absolute z-40 overflow-y-auto rounded-xl border border-hairline/60 bg-panel p-1.5 shadow-xl" onClick={(event) => {
        const details = event.currentTarget.closest("details"); details?.querySelector("summary")?.focus(); details?.removeAttribute("open");
      }}>
        <TeamMapRoomList rooms={rooms} menuFor={menu?.groupId} onOpen={(id) => dispatch({ type: "select", id })} onMenu={setMenu} onNew={() => setCreating(true)} />
      </div>
    </details>
    <RoomMenu menu={menu} onClose={closeMenu} onDelete={setDeletingId} />
    <ConfirmDialog
      open={deleting !== undefined}
      {...roomDeleteCopy(deleting ?? { name: "" })}
      icon={<Trash2 size={18} />}
      returnFocusRef={toggleRef}
      onCancel={() => setDeletingId(null)}
      onConfirm={() => {
        const groupId = deleting?.id;
        setDeletingId(null);
        if (groupId) dispatch({ type: "deleteGroup", groupId });
      }}
    />
    {creating && <NewRoomPanel onClose={() => setCreating(false)} />}
  </>;
}
