import { describe, expect, it } from "vitest";

import type { TemplateSyncDiff } from "../../shared/template-sync";
import { ROLE_FIELD_LABEL, summarizeDiff } from "./template-sync";

const diff = (over: Partial<TemplateSyncDiff> = {}): TemplateSyncDiff => ({
  templateId: "t1", templateName: "都市短剧团队", fromVersion: 1, toVersion: 2,
  changed: [], unchanged: [], added: [], removed: [], ...over,
});

describe("summarizeDiff", () => {
  it("marks a renamed matched role and keeps its changed fields", () => {
    const summary = summarizeDiff(diff({
      changed: [{ key: "writer", botId: "b1", templateName: "编剧", currentName: "我的编剧", fields: ["persona", "model"] }],
    }));
    expect(summary.changed).toEqual([{ key: "writer", from: "我的编剧", to: "编剧", renamed: true, fields: ["persona", "model"] }]);
    expect(summary.nothingToApply).toBe(false);
    expect(summary.identical).toBe(false);
  });

  it("lists added and removed roles and reports nothing to apply when no settings differ", () => {
    const summary = summarizeDiff(diff({
      added: [{ key: "director", name: "导演", title: "现场" }],
      removed: [{ key: "sound", name: "音效", botId: "b9" }],
    }));
    expect(summary.added).toEqual([{ key: "director", name: "导演", title: "现场" }]);
    expect(summary.removed).toEqual([{ key: "sound", name: "音效" }]);
    expect(summary.nothingToApply).toBe(true);
    expect(summary.identical).toBe(false);
  });

  it("calls a role whose name matches the template not renamed", () => {
    const summary = summarizeDiff(diff({
      changed: [{ key: "writer", botId: "b1", templateName: "编剧", currentName: "编剧", fields: ["skills"] }],
    }));
    expect(summary.changed[0]!.renamed).toBe(false);
  });

  it("calls two matching teams identical", () => {
    expect(summarizeDiff(diff()).identical).toBe(true);
  });
});

describe("ROLE_FIELD_LABEL", () => {
  it("has a key for every changed setting", () => {
    expect(Object.keys(ROLE_FIELD_LABEL).sort()).toEqual(["mcp", "model", "persona", "skills"]);
    for (const key of Object.values(ROLE_FIELD_LABEL)) expect(key.startsWith("templateSync.field.")).toBe(true);
  });
});
