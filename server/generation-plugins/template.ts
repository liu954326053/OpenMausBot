// The template language of a plugin's requests: `{{name}}` placeholders in URLs, headers and bodies, and a small path
// grammar for reading an answer (`data[].url`, `task.id`, `output[0].percent`). Nothing here evaluates code.

const WHOLE = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/;
const ANY = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** `value` with every placeholder filled from `vars`; a string that is one placeholder keeps the value's own type. */
export function fillTemplate(value: unknown, vars: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === "string") {
    const whole = WHOLE.exec(value);
    if (whole) return vars[whole[1]!];
    return value.replace(ANY, (_match, name: string) => {
      const found = vars[name];
      if (found === undefined || found === null) return "";
      return typeof found === "object" ? JSON.stringify(found) : String(found);
    });
  }
  if (Array.isArray(value)) return value.map((item) => fillTemplate(item, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillTemplate(item, vars)]));
  }
  return value;
}

type Step = { key: string } | { index: number } | { all: true };

function steps(path: string): Step[] {
  const out: Step[] = [];
  for (const part of path.replace(/^\$\.?/, "").split(".")) {
    if (!part) continue;
    const match = /^(.*?)((?:\[\d+\]|\[\])*)$/.exec(part);
    const key = match?.[1] ?? "";
    if (key) out.push({ key });
    for (const index of match?.[2]?.matchAll(/\[(\d*)\]/g) ?? []) out.push(index[1] === "" ? { all: true } : { index: Number(index[1]) });
  }
  return out;
}

const descend = (value: unknown, step: Step): unknown[] => {
  if ("all" in step) return Array.isArray(value) ? value : [];
  if ("index" in step) return Array.isArray(value) && value[step.index] !== undefined ? [value[step.index]] : [];
  return value && typeof value === "object" && !Array.isArray(value) ? [(value as Record<string, unknown>)[step.key]] : [];
};

/** What `path` names in `data`; an array when the path has `[]`, undefined when nothing is there. */
export function readPath(data: unknown, path: string): unknown {
  let current: unknown[] = [data];
  let spread = false;
  for (const step of steps(path)) {
    if ("all" in step) spread = true;
    current = current.flatMap((value) => descend(value, step)).filter((value) => value !== undefined);
    if (current.length === 0) return undefined;
  }
  return spread ? current : current[0];
}

/** The strings `path` names, in order; a single value counts as one. */
export function readStrings(data: unknown, path: string | undefined): string[] {
  if (!path) return [];
  const found = readPath(data, path);
  const list = Array.isArray(found) ? found : [found];
  return list.filter((item): item is string => typeof item === "string" && item !== "");
}

export function readNumber(data: unknown, path: string | undefined): number | undefined {
  if (!path) return undefined;
  const found = readPath(data, path);
  const value = Array.isArray(found) ? found[0] : found;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function readText(data: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const found = readPath(data, path);
  const value = Array.isArray(found) ? found[0] : found;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
