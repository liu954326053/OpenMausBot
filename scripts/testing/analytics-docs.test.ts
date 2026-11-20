// docs/analytics.md promises that the app sends no usage analytics; the docs site shows the same page, and no page
// describing the app as it is offers analytics to turn off.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8").replace(/\r\n/g, "\n");

/** Dated plans and specs record what was decided then, so only the rest describes the app as it is. */
function currentDocs(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "README.md", "SECURITY.md", "docs", "apps/docs/content"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.mdx?$/.test(file) && !/^docs\/(plans|superpowers)\//.test(file));
}

const ANALYTICS_ON = [/i\.posthog\.com/, /\bphc_/, /usage analytics are optional/i, /→ Usage analytics/, /\banalytics on\b/i, /optional PostHog/];

describe("docs/analytics.md", () => {
  it("says MagicBot sends no usage analytics", () => {
    const docs = read("docs/analytics.md");
    expect(docs).toContain("MagicBot sends no usage analytics.");
    expect(ANALYTICS_ON.filter((said) => said.test(docs))).toEqual([]);
  });

  it("is the page the docs site shows", () => {
    const docs = read("docs/analytics.md");
    const site = read("apps/docs/content/docs/security/analytics.mdx");
    expect(site.slice(site.indexOf("\n---\n", 3) + "\n---\n".length)).toBe(docs.slice(docs.indexOf("\n") + 1));
  });

  it("is what every other page says", () => {
    const contradicting = currentDocs().flatMap((file) => {
      const text = read(file);
      return ANALYTICS_ON.filter((said) => said.test(text)).map((said) => `${file}: ${said}`);
    });
    expect(contradicting).toEqual([]);
  });
});
