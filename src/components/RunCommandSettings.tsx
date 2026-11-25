import { runCommandEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { useConfigSave } from "./BrowserSettingsRows";
import { MoreText, SettingRow, Switch } from "./SettingsPrimitives";

/** features.runCommand. Shown only where the server reports the flag: a Cloud home or a hosted workspace leaves it out. */
export function RunCommandSettings() {
  const { state } = useStore();
  const on = runCommandEnabled(state.config);
  const { saving, error, save } = useConfigSave();
  if (state.config?.features?.runCommand === undefined) return null;

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
    </div>
  );
}
