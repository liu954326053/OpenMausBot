import { useSyncExternalStore } from "react";
import { Map as MapIcon, Maximize, Minus, Plus, Waypoints } from "lucide-react";
import { t } from "@/lib/i18n";
import type { CameraStore } from "../engine/camera";

/** A scope written with a leading space reads after the short name, as in "Linhas de referência de personagens". */
function ReferencesLabel() {
  const scope = t("productionBoard.toolbar.referencesScope");
  const long = <span className="tlong">{scope}</span>;
  const after = scope.startsWith(" ");
  return (
    <span className="tkeep">
      {after ? null : long}
      {t("productionBoard.toolbar.referencesLabel")}
      {after ? long : null}
    </span>
  );
}

export function Toolbar({ camera, showRefs, minimap, onZoom, onZoomReset, onFit, onRefs, onMinimap }: {
  camera: CameraStore;
  showRefs: boolean;
  minimap: boolean;
  onZoom(factor: number): void;
  onZoomReset(): void;
  onFit(): void;
  onRefs(): void;
  onMinimap(): void;
}) {
  const percent = useSyncExternalStore(camera.subscribe, () => Math.round(camera.cam.z * 100));
  return (
    <div className="toolbar" role="toolbar" aria-label={t("productionBoard.toolbar.label")}>
      <button type="button" className="tbtn" aria-label={t("productionBoard.toolbar.zoomOut")} onClick={() => onZoom(0.8)}>
        <Minus className="ic" aria-hidden="true" />
      </button>
      <button type="button" className="tzoom" aria-label={t("productionBoard.toolbar.zoomReset", { percent })} onClick={onZoomReset}>
        {t("productionBoard.toolbar.zoom", { percent })}
      </button>
      <button type="button" className="tbtn" aria-label={t("productionBoard.toolbar.zoomIn")} onClick={() => onZoom(1.25)}>
        <Plus className="ic" aria-hidden="true" />
      </button>
      <span className="tsep" aria-hidden="true" />
      <button type="button" className="tbtn wide" aria-label={t("productionBoard.toolbar.fit")} onClick={onFit}>
        <Maximize className="ic" aria-hidden="true" />
        <span>{t("productionBoard.toolbar.fitLabel")}</span>
      </button>
      <button type="button" className="tbtn wide keep" aria-pressed={showRefs} aria-label={t("productionBoard.toolbar.references")} onClick={onRefs}>
        <Waypoints className="ic" aria-hidden="true" />
        <ReferencesLabel />
      </button>
      <button type="button" className="tbtn" aria-pressed={minimap} aria-label={t("productionBoard.toolbar.minimap")} onClick={onMinimap}>
        <MapIcon className="ic" aria-hidden="true" />
      </button>
    </div>
  );
}
