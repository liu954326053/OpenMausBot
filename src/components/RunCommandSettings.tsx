import { useEffect, useId, useState } from "react";

import { runCommandEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { useConfigSave } from "./BrowserSettingsRows";
import { MoreText, SETTINGS_INPUT, SettingRow, Switch } from "./SettingsPrimitives";

const splitNames = (text: string) => [...new Set(text.split(/[\s,]+/u).filter(Boolean))];

/** features.runCommand. Shown only where the server reports the flag: a Cloud home or a hosted workspace leaves it out. */
export function RunCommandSettings() {
  const { state } = useStore();
  const on = runCommandEnabled(state.config);
  const saved = (state.config?.features?.runCommandEnv ?? []).join(" ");
  const [draft, setDraft] = useState(saved);
  const { saving, error, save } = useConfigSave();
  const envLabel = useId();
  const envHelp = useId();

  useEffect(() => setDraft(saved), [saved]);
  if (state.config?.features?.runCommand === undefined) return null;

  const commitEnv = () => {
    const names = splitNames(draft);
    if (names.join(" ") === saved) return;
    setDraft(names.join(" "));
    void save({ features: { runCommandEnv: names } });
  };

  return (
    <div data-testid="run-command-settings" className="contents">
      <SettingRow title={t("settings.experimental.runCommand")} tag={t("settings.early.tag")}
        subtitle={<MoreText short={t("settings.experimental.runCommandShort")} long={t("settings.experimental.runCommandDetail")} />}
        message={error ? <span role="alert" className="text-danger">{error}</span> : undefined}>
        <Switch
          checked={on}
          aria-label={t("settings.experimental.runCommand")}
          disabled={saving}
          onClick={() => void save({ features: { runCommand: !on } })}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </SettingRow>
      <div className="flex flex-col gap-1 px-4 py-[13px]">
        <label htmlFor={`${envLabel}-input`} className="text-[14px] leading-5 text-ink">{t("settings.experimental.runCommandEnv")}</label>
        <input
          id={`${envLabel}-input`}
          data-testid="run-command-env"
          value={draft}
          placeholder={t("settings.experimental.runCommandEnvPlaceholder")}
          aria-describedby={envHelp}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitEnv}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitEnv();
          }}
          className={`${SETTINGS_INPUT} font-mono disabled:cursor-wait`}
        />
        <div id={envHelp} className="text-[12px] leading-4 text-ink-secondary">{t("settings.experimental.runCommandEnvHelp")}</div>
      </div>
    </div>
  );
}
