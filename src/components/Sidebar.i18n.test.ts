import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { initialState, type Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({}),
}));

import { ConfirmDialogCard } from "./ConfirmDialog";
import { BotListItem, BotThreadList, botConfirmCopy, botRowProps } from "./Sidebar";

const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "atlas",
  threadId: "thread-atlas",
  name: "Atlas",
  title: "",
  description: "",
  notifications: true,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "claude", model: "test" },
  messages: [],
  ...overrides,
}) as Bot;

const rowProps = (value: Bot) => botRowProps(initialState, () => {}, value, { density: "comfortable", onMenu: () => {} });

function renderRow(value: Bot): string {
  return renderToStaticMarkup(createElement(BotListItem, rowProps(value)));
}

afterEach(() => {
  setLocale("en");
});

describe("sidebar rows", () => {
  it("translates a legacy thread's fallback title", () => {
    setLocale("ja");
    const markup = renderToStaticMarkup(createElement(BotThreadList, { ...rowProps(bot()), selected: true }));
    expect(markup).toContain(`title="${t("task.newShort")}"`);
    expect(markup).not.toContain('title="New thread"');
  });

  it("translates the row's own copy and its actions", () => {
    setLocale("pt-br");
    const markup = renderRow(bot({ chiefOfStaff: true, busy: true }));

    expect(markup).toContain("Chefe de gabinete");
    expect(markup).toContain(`>${t("chat.activity.thinking")}</span>`);
    expect(markup).not.toContain("Chief of Staff");

    setLocale("ja");
    expect(renderRow(bot())).toContain(`aria-label="${t("sidebar.bot.actions", { name: "Atlas" })}"`);
  });
});

describe("archive / delete confirmation copy", () => {
  it("translates and keeps the bot's name out of the catalog", () => {
    setLocale("pt-br");
    const archive = botConfirmCopy("archive", "Juniper");
    expect(archive.title).toBe("Arquivar Juniper?");
    expect(archive.confirmLabel).toBe("Arquivar");

    const remove = botConfirmCopy("delete", "Willow");
    expect(remove.body).toContain("Willow");
    expect(remove.confirmLabel).toBe("Excluir");
    setLocale("zh");
    expect(botConfirmCopy("delete", "Willow").title).toBe("删除 Willow？");
  });
});

describe("a delete confirmation", () => {
  it("renders as a danger alert dialog with Cancel before the delete action", () => {
    const markup = renderToStaticMarkup(createElement(ConfirmDialogCard, {
      open: true,
      ...botConfirmCopy("delete", "Willow"),
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }));
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain("Delete Willow?");
    expect(markup.indexOf(">Cancel</button>")).toBeLessThan(markup.indexOf(">Delete</button>"));
    expect(markup).toContain("bg-danger");
  });

  it("offers a gentler way beside the destructive one when there is one, after Cancel", () => {
    const markup = renderToStaticMarkup(createElement(ConfirmDialogCard, {
      open: true, title: "Delete Chief?", body: "Its chats hold your setup.", confirmLabel: "Delete", tone: "danger",
      onCancel: vi.fn(), onConfirm: vi.fn(), alternative: { label: "Archive instead", onClick: vi.fn() },
    }));
    expect(markup.indexOf(">Cancel</button>")).toBeLessThan(markup.indexOf(">Archive instead</button>"));
    expect(markup.indexOf(">Archive instead</button>")).toBeLessThan(markup.indexOf(">Delete</button>"));
  });
});
