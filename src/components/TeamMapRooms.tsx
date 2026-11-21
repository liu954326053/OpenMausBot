import { useState } from "react";
import { MessageCircle, MessagesSquare, Plus } from "lucide-react";

import { t } from "@/lib/i18n";
import { useStore, type Group } from "@/state/store";
import { useTeamProjectSide } from "@/state/team-projects";
import { NewRoomPanel } from "./SidebarNewRoomPanel";

const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-[12px] hover:bg-control focus-visible:outline-2 focus-visible:outline-accent";

export function TeamMapRoomList({ rooms, onOpen, onNew }: { rooms: Pick<Group, "id" | "name" | "dm" | "unread">[]; onOpen: (id: string) => void; onNew: () => void }) {
  return <>
    {rooms.length === 0 && <p className="px-3 py-2.5 text-[12px] text-ink-secondary">{t("sidebarProjects.mapRoomsEmpty")}</p>}
    {rooms.map((room) => <button key={room.id} data-team-map-room={room.id} className={item} onClick={() => onOpen(room.id)}>
      {room.dm ? <MessageCircle size={14} className="shrink-0 text-ink-secondary" /> : <MessagesSquare size={14} className="shrink-0 text-ink-secondary" />}
      <span className="min-w-0 flex-1 truncate">{room.name}</span>
      {room.unread && <span data-team-map-room-unread="" role="img" aria-label={t("task.unread")} className="size-2 shrink-0 rounded-full bg-accent" />}
    </button>)}
    <div className="my-1 h-px bg-hairline/50" />
    <button className={item} onClick={onNew}><Plus size={14} className="shrink-0 text-ink-secondary" />{t("sidebar.newChannel.title")}</button>
  </>;
}

/** The group chats and bot chats outside projects: the sidebar lists only the projects' own. */
export function TeamMapRooms() {
  const { state, dispatch } = useStore();
  const rooms = useTeamProjectSide().rooms(state.groups);
  const [creating, setCreating] = useState(false);
  const unread = rooms.some((room) => room.unread);
  return <>
    <details className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute("open"); }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.currentTarget.removeAttribute("open"); event.currentTarget.querySelector("summary")?.focus(); }
    }}>
      <summary data-team-map-rooms="" className="relative flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-[12px] font-medium hover:bg-control [&::-webkit-details-marker]:hidden">
        <MessagesSquare size={14} />{t("sidebar.section.channels")}
        <span className="tabular-nums text-ink-secondary">{rooms.length}</span>
        {unread && <span data-team-map-rooms-unread="" role="img" aria-label={t("task.unread")} className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-app" />}
      </summary>
      <div className="absolute end-0 top-full z-40 mt-2 max-h-80 w-64 overflow-y-auto rounded-xl border border-hairline/60 bg-panel p-1.5 shadow-xl" onClick={(event) => {
        const details = event.currentTarget.closest("details"); details?.querySelector("summary")?.focus(); details?.removeAttribute("open");
      }}>
        <TeamMapRoomList rooms={rooms} onOpen={(id) => dispatch({ type: "select", id })} onNew={() => setCreating(true)} />
      </div>
    </details>
    {creating && <NewRoomPanel onClose={() => setCreating(false)} />}
  </>;
}
