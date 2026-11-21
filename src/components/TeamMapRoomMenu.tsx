import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ClipboardCopy, Pencil, TextQuote, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { nextRename } from "@/lib/rename";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { navigateThreadMenu } from "./BotProjects";
import { MENU_ITEM, MENU_SHEET } from "./menu-recipe";
import { useHeldMenuMotion } from "./MenuMotion";

export type RoomMenuAt = { groupId: string; x: number; y: number };

const EDIT_BUTTON = "flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink";

/** A group chat's or bot chat's menu: rename, a group chat's description, its conversation ID and delete. A remote
 * client only copies the ID. Focus moves to the first item and goes back to whatever opened the menu. */
export function RoomMenu({ menu, onClose, onDelete }: { menu: RoomMenuAt | null; onClose: () => void; onDelete: (groupId: string) => void }) {
  const motion = useHeldMenuMotion(menu);
  const shown = motion.value;
  const dispatch = useStoreDispatch();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const group = useStoreSelector((s) => shown ? s.groups.find((g) => g.id === shown.groupId) : undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<"name" | "description" | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => setEditing(null), [menu]);
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !shown) return;
    const place = () => {
      const { offsetWidth: width, offsetHeight: height } = element;
      element.style.top = `${Math.max(8, Math.min(shown.y, window.innerHeight - height - 8))}px`;
      element.style.left = `${Math.max(8, Math.min(shown.x, window.innerWidth - width - 8))}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  useEffect(() => {
    if (!menu) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-room-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!motion.shown || !group || !shown) return null;
  const isBotChat = Boolean(group.dm);
  const edit = (field: "name" | "description") => {
    setDraft(field === "name" ? group.name : group.description ?? "");
    setEditing(field);
  };
  const save = () => {
    if (editing === "name") {
      const name = nextRename(group.name, draft);
      if (name) dispatch({ type: "patchGroup", groupId: group.id, patch: { name } });
    } else if (draft.trim() !== (group.description ?? "")) {
      dispatch({ type: "patchGroup", groupId: group.id, patch: { description: draft.trim() } });
    }
    onClose();
  };
  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button key={label} role="menuitem" onClick={onClick} className={cn(MENU_ITEM, danger ? "text-danger" : "text-ink", "hover:bg-menu-hover")}>{icon}{label}</button>
  );
  const naming = editing === "name";
  return createPortal(
    <div
      ref={menuRef}
      data-room-menu=""
      role="menu"
      aria-label={t("sidebar.bot.actions", { name: group.name })}
      onKeyDown={editing ? undefined : navigateThreadMenu}
      className={cn("fixed z-40 w-[228px] overflow-hidden", MENU_SHEET, motion.className)} {...motion.exitProps}
    >
      {editing ? (
        <div className="flex items-center gap-1 px-2 py-1">
          <input
            autoFocus
            dir="auto"
            value={draft}
            maxLength={naming ? 100 : 120}
            placeholder={naming ? undefined : t("sidebar.room.descriptionPlaceholder")}
            aria-label={naming ? t("sidebar.room.renameAria", { name: group.name }) : t("sidebar.room.descriptionAria", { name: group.name })}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                save();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="min-w-0 flex-1 rounded-lg bg-raised px-2 py-1.5 text-[14px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button type="button" onClick={save} title={t("common.save")} className={EDIT_BUTTON}
            aria-label={!naming ? t("sidebar.room.saveDescription") : isBotChat ? t("sidebar.room.saveChatName") : t("sidebar.room.saveChannelName")}>
            <Check size={15} />
          </button>
          <button type="button" onClick={onClose} title={t("common.cancel")} className={EDIT_BUTTON}
            aria-label={!naming ? t("common.cancel") : isBotChat ? t("sidebar.room.cancelChatRename") : t("sidebar.room.cancelChannelRename")}>
            <X size={15} />
          </button>
        </div>
      ) : <>
        {!remoteClient && item(<Pencil size={16} className="text-ink-secondary" />, isBotChat ? t("sidebar.room.renameChat") : t("sidebar.room.renameChannel"), () => edit("name"))}
        {!remoteClient && !isBotChat && item(<TextQuote size={16} className="text-ink-secondary" />, t("sidebar.room.setDescription"), () => edit("description"))}
        {item(<ClipboardCopy size={16} className="text-ink-secondary" />, t("sidebar.copyConversationId"), () => { void copyText(group.threadId); onClose(); })}
        {!remoteClient && item(<Trash2 size={16} />, isBotChat ? t("sidebar.room.deleteChat") : t("sidebar.room.deleteChannel"), () => { onClose(); onDelete(group.id); }, true)}
      </>}
    </div>,
    document.body,
  );
}
