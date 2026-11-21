const ALIASES: Record<string, string> = { pt: "pt-br", "zh-hant": "zh-tw", "zh-hk": "zh-tw", "zh-mo": "zh-tw" };

/** The entry for the language set in Settings, else for its parent ("pt-br" → "pt"), else English. */
export function byLanguage<T>(table: { en: T } & Partial<Record<string, T>>, language: string | undefined): T {
  let candidate = language?.trim().toLowerCase() || "en";
  while (candidate) {
    const entry = table[ALIASES[candidate] ?? candidate];
    if (entry !== undefined) return entry;
    const separator = candidate.lastIndexOf("-");
    if (separator < 0) break;
    candidate = candidate.slice(0, separator);
  }
  return table.en;
}

/** OMB_DEFAULT_LANGUAGE: the language bots speak and the server writes its own lines in while config.json names none,
 * as whoever started the server chose it. The desktop app starts its server with Simplified Chinese. */
export function startupLanguage(): string | undefined {
  return process.env.OMB_DEFAULT_LANGUAGE?.trim() || undefined;
}

/** A new bot's language while config.json names none: the start-up language, else this computer's locale. */
export function defaultLanguage(): string {
  return startupLanguage() ?? Intl.DateTimeFormat().resolvedOptions().locale;
}

/** The locale dates and times are formatted in: the language set in Settings, else US English. */
export function intlLocale(language: string | undefined): string {
  try {
    return Intl.getCanonicalLocales(language?.trim() || "en-US")[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}
