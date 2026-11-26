// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node-prompt-panel.tsx and
// canvas-reference-bar.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import type { GenerationModel, SettingProblem } from "../../../shared/project-generation";
import { t } from "@/lib/i18n";
import type { SettingKey, SettingValue } from "@/lib/project-canvas/settings";

function settingLabel(key: SettingKey): string {
  switch (key) {
    case "model": return t("projectCanvas.settings.model");
    case "aspect": return t("projectCanvas.settings.aspect");
    case "quality": return t("projectCanvas.settings.quality");
    case "count": return t("projectCanvas.settings.count");
    case "resolution": return t("projectCanvas.settings.resolution");
    case "seconds": return t("projectCanvas.settings.seconds");
  }
}

export function settingValueLabel(key: SettingKey, value: SettingValue, models?: readonly GenerationModel[] | null): string {
  if (key === "model") return models?.find((model) => model.id === value)?.name ?? (String(value) || t("projectCanvas.settings.noModel"));
  if (key === "seconds") return t("projectCanvas.settings.secondsValue", { count: value });
  if (key === "count") return t("projectCanvas.settings.countValue", { count: value });
  if (key === "quality") {
    switch (String(value).toLowerCase()) {
      case "auto": return t("projectCanvas.settings.qualityAuto");
      case "low": return t("projectCanvas.settings.qualityLow");
      case "medium": return t("projectCanvas.settings.qualityMedium");
      case "high": return t("projectCanvas.settings.qualityHigh");
      case "standard": return t("projectCanvas.settings.qualityStandard");
      case "hd": return t("projectCanvas.settings.qualityHd");
    }
  }
  return String(value);
}

export function problemText(problem: SettingProblem, models?: readonly GenerationModel[] | null): string {
  if (problem.key === "referenceImages") return t("projectCanvas.settings.noReferenceImages");
  if (problem.key === "referenceAudio") return t("projectCanvas.settings.noReferenceAudio");
  if (problem.key === "model") return t("projectCanvas.settings.modelMissing", { model: String(problem.value) || t("projectCanvas.settings.noModel") });
  return t("projectCanvas.settings.notOffered", { setting: settingLabel(problem.key), value: settingValueLabel(problem.key, problem.value, models) });
}
