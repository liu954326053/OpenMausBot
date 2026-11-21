import { t } from "@/lib/i18n";

/** A page of Settings as a sentence names it: "Settings → Data". */
const settingsPlace = (page: string): string => `${t("settings.title")} → ${page}`;

export const dataSettingsPlace = (): string => settingsPlace(t("settings.page.data"));
