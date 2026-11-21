import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { ConfirmDialogCard } from "./ConfirmDialog";
import { roomDeleteCopy } from "./room-delete-copy";

afterEach(() => {
  setLocale("en");
});

describe("room delete confirmation copy", () => {
  it("names the group chat and says what goes and what stays", () => {
    const copy = roomDeleteCopy({ name: "Launch plan" });
    expect(copy.title).toBe("Delete Launch plan?");
    expect(copy.body).toContain("Launch plan group chat");
    expect(copy.body).toMatch(/every thread in it/);
    expect(copy.body).toMatch(/routines/);
    expect(copy.body).toMatch(/bots in it are not deleted/);
    expect(copy.body).toMatch(/cannot be undone/);
    expect(copy.confirmLabel).toBe(t("sidebar.room.deleteChannel"));
    expect(copy.tone).toBe("danger");
  });

  it("uses the thread wording for a bot-to-bot room", () => {
    const copy = roomDeleteCopy({ name: "Pen ⇄ Ink", dm: true });
    expect(copy.title).toBe("Delete Pen ⇄ Ink?");
    expect(copy.body).toContain("Pen ⇄ Ink thread");
    expect(copy.body).not.toMatch(/group chat/);
    expect(copy.confirmLabel).toBe(t("sidebar.room.deleteChat"));
  });

  it("renders as a danger alert dialog with Cancel before the delete action", () => {
    const markup = renderToStaticMarkup(createElement(ConfirmDialogCard, {
      open: true,
      ...roomDeleteCopy({ name: "Launch plan" }),
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }));
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain("Delete Launch plan?");
    expect(markup.indexOf(">Cancel</button>")).toBeLessThan(markup.indexOf(">Delete group chat</button>"));
    expect(markup).toContain("bg-danger");
  });

  it("keeps the room's name intact in other languages", () => {
    setLocale("pt-br");
    expect(roomDeleteCopy({ name: "Launch plan" }).title).toContain("Launch plan");
    expect(roomDeleteCopy({ name: "Launch plan" }).confirmLabel).toBe(t("sidebar.room.deleteChannel"));
    setLocale("zh");
    expect(roomDeleteCopy({ name: "Launch plan" }).title).toContain("Launch plan");
    expect(roomDeleteCopy({ name: "Pen ⇄ Ink", dm: true }).confirmLabel).toBe(t("sidebar.room.deleteChat"));
  });
});
