// A generation plugin is a folder in the data directory whose `plugin.json` declares models and the HTTP requests that
// make them (docs/generation-plugins.md). These are its wire types: what a plugin file holds, what the plugin manager
// shows, and the bodies `/api/generation-plugins/*` takes. Model fields are the ones `list_models` already defines.

import type { GenerationKind, GenerationModel } from "./project-generation.ts";

export const GENERATION_PLUGIN_SCHEMA_VERSION = 1;
export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const PLUGIN_ZIP_MAX_BYTES = 8 * 1024 * 1024;
export const PLUGIN_FILES_MAX = 200;
export const PLUGIN_UNPACKED_MAX_BYTES = 32 * 1024 * 1024;
export const PLUGIN_MODELS_MAX = 200;
export const PLUGIN_FIELDS_MAX = 40;

export type GenerationPluginFieldType = "text" | "url" | "secret" | "number" | "boolean" | "select";
export type GenerationPluginValue = string | number | boolean;

/** One thing a plugin needs configuring; the form in the plugin manager is generated from these. */
export interface GenerationPluginField {
  key: string;
  label: string;
  type: GenerationPluginFieldType;
  required?: boolean;
  /** What the person sees before typing; never a value that is already saved. */
  placeholder?: string;
  help?: string;
  /** `select` only. */
  choices?: string[];
  default?: GenerationPluginValue;
}

/** A plugin as the app shows it: never a secret's value, only whether one is saved. */
export interface GenerationPluginSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  kinds: GenerationKind[];
  models: GenerationModel[];
  fields: GenerationPluginField[];
  enabled: boolean;
  /** Every required field has a value. */
  configured: boolean;
  /** Non-secret values, and the defaults of the ones never set. */
  values: Record<string, GenerationPluginValue>;
  /** The keys of the secret fields that have a saved value. */
  secrets: string[];
  installedAt?: number;
  /** Why the plugin cannot be used, in words; absent when it can. */
  problem?: string;
}

export interface GenerationPluginsWire {
  plugins: GenerationPluginSummary[];
}

export interface GenerationPluginWire {
  plugin: GenerationPluginSummary;
}

/** `POST /api/generation-plugins/install`: a zip, base64. */
export interface InstallGenerationPluginInput {
  name: string;
  data: string;
}

/** `PATCH /api/generation-plugins/:id`: turn it on or off, and save the fields that changed. A secret left out or empty
 * keeps the one saved. */
export interface SaveGenerationPluginInput {
  enabled?: boolean;
  values?: Record<string, GenerationPluginValue>;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "host.docker.internal", "host.containers.internal"]);

/** A plugin's address: any https one, or a loopback http one, without credentials, query or fragment. */
export function normalizePluginUrl(value: string): string {
  const problem = "Use an https address, or http for a plugin on this computer, without a password, query or fragment";
  const text = value.trim();
  if (!text || text.length > 2048) throw new Error(problem);
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(problem); }
  if (url.username || url.password || url.search || url.hash) throw new Error(problem);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (LOOPBACK.has(url.hostname.toLowerCase()) || url.hostname.toLowerCase().endsWith(".local")))) {
    throw new Error(problem);
  }
  return url.toString().replace(/\/+$/, "");
}
