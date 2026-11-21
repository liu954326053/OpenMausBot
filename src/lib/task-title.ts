import { CHOOSE_CHIEF_TITLE } from "../../shared/inbox";
import { SHARED_CHAT_TITLE } from "../../shared/wire";
import { t } from "./i18n";

/** Localize the factory title while preserving titles chosen by the user. */
export function localizedTaskTitle(title: string): string {
  if (title === SHARED_CHAT_TITLE) return t("task.sharedChat");
  if (title === CHOOSE_CHIEF_TITLE) return t("task.chooseChief");
  return title === "New thread" ? t("task.untitledChat") : title;
}
