import type { GenerationPluginWire, GenerationPluginsWire, SaveGenerationPluginInput } from "../../shared/generation-plugins.ts";
import { api } from "@/state/store";

export const loadGenerationPlugins = () => api<GenerationPluginsWire>("/api/generation-plugins");

export const installGenerationPlugin = (name: string, data: string) => api<GenerationPluginWire>("/api/generation-plugins/install", {
  method: "POST",
  body: JSON.stringify({ name, data }),
});

export const saveGenerationPlugin = (id: string, patch: SaveGenerationPluginInput) => api<GenerationPluginWire>(`/api/generation-plugins/${encodeURIComponent(id)}`, {
  method: "PATCH",
  body: JSON.stringify(patch),
});

export const deleteGenerationPlugin = (id: string) => api<{ ok: boolean }>(`/api/generation-plugins/${encodeURIComponent(id)}`, { method: "DELETE" });

/** A chosen file's bytes, base64, as the install route takes them. */
export function pluginFileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("the file could not be read"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.readAsDataURL(file);
  });
}
