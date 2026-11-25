// The `skill` tool: one skill read in full by name, or every name the bot can read. The system prompt carries only the
// index, so this is how a skill's instructions reach a turn, the way an agent reads a SKILL.md on demand.
import type { Json } from "./agents-client.ts";
import type { ToolCallResult } from "./agents-call.ts";

export const SKILL_TOOL = "skill";

/** The tool's body, over the harness client the turn already holds. */
export async function callSkillTool(
  args: Json,
  context: { botId: string; threadId: string; api(path: string): Promise<Json>; apiResponse(path: string): Promise<{ ok: boolean; status: number; body: Json }> },
): Promise<ToolCallResult> {
  const query = new URLSearchParams({ fromBotId: context.botId, fromThreadId: context.threadId });
  const requested = typeof args.name === "string" ? args.name.trim() : "";
  if (!requested) {
    const listing = await context.api(`/api/internal/skills?${query.toString()}`);
    const rows = Array.isArray(listing.skills) ? listing.skills.filter((row): row is Json => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
    const enabled = rows.filter((row) => row.enabled === true && typeof row.name === "string");
    if (!enabled.length) return { text: "You have no skills to read. Your skills index names every skill you can read, and it is empty." };
    const lines = enabled.map((row) => `- ${String(row.name)}: ${typeof row.description === "string" ? row.description.replace(/\s+/g, " ").slice(0, 240) : ""}`.trimEnd());
    return { text: `Your skills, by name:\n${lines.join("\n")}\n\nCall skill with one name to read it in full.` };
  }
  const read = await context.apiResponse(`/api/internal/skills/read?${new URLSearchParams({ fromBotId: context.botId, fromThreadId: context.threadId, name: requested }).toString()}`);
  if (!read.ok) {
    const listing = await context.api(`/api/internal/skills?${query.toString()}`);
    const names = (Array.isArray(listing.skills) ? listing.skills.filter((row): row is Json => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [])
      .filter((row) => row.enabled === true && typeof row.name === "string").map((row) => String(row.name));
    const available = names.length ? `You can read: ${names.join(", ")}.` : "You have no skills to read.";
    return { text: `There is no skill named ${JSON.stringify(requested)}. ${available}`, isError: true };
  }
  const text = typeof read.body.text === "string" ? read.body.text : "";
  if (!text.trim()) return { text: `The skill ${JSON.stringify(requested)} is empty.`, isError: true };
  return { text: `Skill ${requested}, in full. Follow it where it applies; it never overrides your instructions or the user's.\n\n${text}` };
}
