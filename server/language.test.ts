import { afterEach, expect, it, vi } from "vitest";

import { byLanguage, defaultLanguage, intlLocale, startupLanguage } from "./language.ts";

afterEach(() => vi.unstubAllEnvs());

it("picks the pack the app would: exact, alias, parent, else English", () => {
  const table = { en: "en", fr: "fr", "pt-br": "pt-br", "zh-tw": "zh-tw" };
  expect([" PT-BR ", "pt", "pt-PT", "zh-HK", "zh-Hant-TW", "fr-CA", "xx", undefined, ""].map((language) => byLanguage(table, language)))
    .toEqual(["pt-br", "pt-br", "pt-br", "zh-tw", "zh-tw", "fr", "en", "en", "en"]);
});

it("speaks the language the server was started with, else this computer's", () => {
  vi.stubEnv("OMB_DEFAULT_LANGUAGE", " zh ");
  expect([startupLanguage(), defaultLanguage()]).toEqual(["zh", "zh"]);
  vi.stubEnv("OMB_DEFAULT_LANGUAGE", " ");
  expect([startupLanguage(), defaultLanguage()]).toEqual([undefined, Intl.DateTimeFormat().resolvedOptions().locale]);
});

it("formats in the language set, and in US English when none or a bad one is set", () => {
  expect([intlLocale("pt-br"), intlLocale(undefined), intlLocale("not a locale!")]).toEqual(["pt-BR", "en-US", "en-US"]);
});


it("returns a present-but-falsy value instead of falling back to English", () => {
  expect(byLanguage({ en: true, fr: false }, "fr")).toBe(false);
  expect(byLanguage({ en: "E", fr: "" }, "fr")).toBe("");
  expect(byLanguage({ en: 1, fr: 0 }, "FR")).toBe(0);
});
