import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";
import {
  CANVAS_CARD_PALETTE_MAX, CANVAS_CARD_ROWS_MAX, CANVAS_CARD_TAGS_MAX, CANVAS_CARD_TEXT_MAX_CHARS, CANVAS_CONTENT_MAX_CHARS, CANVAS_MAX_OPS, CANVAS_PROMPT_MAX_CHARS,
  CANVAS_TITLE_MAX_CHARS,
} from "../../shared/project-canvas.ts";

export const PROJECT_CANVAS_TOOL_NAMES: ReadonlySet<string> = new Set(["canvas_get_state", "canvas_apply_ops", "canvas_generate", "production_plan"]);
/** Listed for a project's lead alone. */
export const PROJECT_LEAD_TOOL_NAMES: ReadonlySet<string> = new Set(["production_plan"]);

const PATHS: Readonly<Record<string, string>> = {
  canvas_get_state: "/api/internal/project-canvas/read",
  canvas_apply_ops: "/api/internal/project-canvas/apply",
  canvas_generate: "/api/internal/project-canvas/generate",
  production_plan: "/api/internal/project-canvas/plan",
};

export async function callProjectCanvasTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(PATHS[name]!, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "That could not be done."), isError: true };
}

const point = { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] };
const cardText = { type: "string", maxLength: CANVAS_CARD_TEXT_MAX_CHARS };
const botRef = { type: "string", maxLength: 200, description: "A bot of the project: its node id, bot:<id>." };

export const PROJECT_CANVAS_TOOL_DEFINITIONS = [
  {
    name: "canvas_get_state",
    description: "Read your project's canvas: with no arguments every bot's node, jobs and status and the nodes in brief; with node_id one node in full; with connected: true, in full, what is connected to your own node. A node's metadata.role says what it is in the production: brief (what the lead agreed with the person), episode (one episode's script, metadata.episode its number), character or scene (a profile; its pictures sit in its group), creation (the node that generates a shot's video, shotId naming the shot), take (a video of a shot; selected: true on the one that goes to post) or final (an episode's finished film). metadata.episode on a shot, a creation, a take or a final names its episode; stale: true means what it was made from changed since. Your replies show on your node by themselves.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        node_id: { type: "string", maxLength: 200, description: "One node's id, a bot's being bot:<id>." },
        connected: { type: "boolean", description: "The nodes connected to your own node, and nothing else." },
      },
    },
  },
  {
    name: "canvas_apply_ops",
    description: "Change your project's canvas, in order, all or nothing. You add text and shot nodes; the server places them and makes the production's connections (pipeline: true), which you cannot delete. What you add by your job: the script bot adds each episode as a text node with metadata.role \"episode\" and metadata.episode its number, the title the episode's name, the content its script and metadata.card.subtitle its logline. The character bot adds each character, and the scene bot each scene, as a text node with metadata.role \"character\" or \"scene\": the title its name, the content its profile, and metadata.card what its card shows (badge, subtitle, tags, rows such as look and voice, palette, and a scene's cameras). They also add image nodes with a prompt and connect the profile into each: the picture joins the profile's group and is generated for you. An episode's storyboard bot adds the episode's shots in order: the title the shot's name, metadata.prompt what it shows, metadata.shot its size, camera move and sound, metadata.settings.seconds its length; connect into each shot the pictures of the characters and the scene it uses, which are its references when its video is generated. Each shot gets a creation node that holds its video settings, and its video is generated for you. You change, connect from and delete only nodes you made. Files you attach become nodes on their own.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ops: {
          type: "array",
          minItems: 1,
          maxItems: CANVAS_MAX_OPS,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["add_node", "update_node", "delete_node", "connect_nodes", "delete_connections"] },
              id: { type: "string", maxLength: 200, description: "update_node and delete_node: the node; delete_connections: the connection." },
              ids: { type: "array", items: { type: "string", maxLength: 200 }, description: "delete_node and delete_connections: several at once." },
              nodeType: { type: "string", enum: ["text", "shot", "image"], description: "add_node: a text node holds content; a shot holds the prompt its video is generated from; an image node, for the character and scene bots only, the prompt a picture is generated from." },
              title: { type: "string", maxLength: CANVAS_TITLE_MAX_CHARS },
              position: { ...point, description: "add_node: where its top-left corner goes; left out, the server places it." },
              metadata: {
                type: "object",
                additionalProperties: false,
                description: "add_node: the node's fields. update_node: the fields to change; null removes one.",
                properties: {
                  content: { type: "string", maxLength: CANVAS_CONTENT_MAX_CHARS, description: "A text node's text, in Markdown." },
                  prompt: { type: "string", maxLength: CANVAS_PROMPT_MAX_CHARS, description: "A shot's or an image node's prompt." },
                  role: { type: "string", enum: ["episode", "character", "scene"], description: "add_node: what the text node is, by your job: an episode's script, a character's profile or a scene's profile." },
                  episode: { type: "integer", minimum: 1, description: "add_node with role \"episode\": the episode's number, from 1." },
                  card: {
                    type: "object",
                    additionalProperties: false,
                    description: "A text node's card: what it shows besides the text.",
                    properties: {
                      badge: { ...cardText, description: "A word or two set apart: a character's part in the drama." },
                      subtitle: { ...cardText, description: "One line under the title: a character's age and occupation, a scene's place and time, an episode's logline." },
                      tags: { type: "array", maxItems: CANVAS_CARD_TAGS_MAX, items: cardText },
                      rows: { type: "array", maxItems: CANVAS_CARD_ROWS_MAX, items: { type: "array", minItems: 2, maxItems: 2, items: cardText }, description: "A label and its value each, such as [\"Look\", \"…\"]." },
                      palette: { type: "array", maxItems: CANVAS_CARD_PALETTE_MAX, items: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, description: "Colours as #rrggbb." },
                      cameras: { type: "integer", minimum: 1, maximum: 99, description: "A scene's number of camera positions." },
                    },
                  },
                  shot: {
                    type: "object",
                    additionalProperties: false,
                    description: "How a shot is filmed.",
                    properties: {
                      size: { ...cardText, description: "The shot size, such as wide or close-up." },
                      move: { ...cardText, description: "The camera's move, such as slow push-in." },
                      audio: { type: "string", maxLength: CANVAS_PROMPT_MAX_CHARS, description: "What is heard: dialogue, sound, music." },
                    },
                  },
                  settings: { type: "object", additionalProperties: true, description: "Generation settings. A shot's video settings, such as model, resolution, aspect or seconds, are where its creation node starts; after that, change the creation node's. An image node's are model, aspect, quality or count." },
                },
              },
              patch: {
                type: "object",
                additionalProperties: false,
                description: "update_node: the node's frame or title.",
                properties: { title: { type: "string", maxLength: CANVAS_TITLE_MAX_CHARS }, position: point, width: { type: "number" }, height: { type: "number" } },
              },
              fromNodeId: { type: "string", maxLength: 200, description: "connect_nodes: the node the reference comes from." },
              toNodeId: { type: "string", maxLength: 200, description: "connect_nodes: the node it goes into." },
            },
            required: ["type"],
          },
        },
      },
      required: ["ops"],
    },
  },
  {
    name: "canvas_generate",
    description: "Generate a shot, image or video node you made, again or with a changed prompt: the production generates each node's first one for you. A shot generates through its creation node: from the shot's prompt, the creation node's settings and the image and audio nodes connected into the creation node; the video lands as the shot's newest take and becomes its selected take, the one that goes to post. Any other node generates from its own prompt and settings and the image and audio nodes connected into it; an image node that already holds a picture is sent first itself, so its prompt reads as an edit of that picture. The node that generates shows the progress. Past a daily allowance a card asks the person to confirm first, so generate only what the task needs.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { node_id: { type: "string", maxLength: 200, description: "The node's id." } },
      required: ["node_id"],
    },
  },
  {
    name: "production_plan",
    description: "For the project's lead only. Plan the drama's production once you and the person agree on what to make: the brief goes on the canvas, and from there the production runs by itself. The script bot adapts the source into episodes; the character and scene bots then design what every episode shares, side by side; when all three are done each episode gets a storyboard bot of its own, its shots' videos are generated as the project's settings allow, and each episode gets a post bot of its own that cuts its film. You hand out no task yourself afterwards: you are told when one fails and when every episode is done. Call it again to change the brief or who does a job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        brief: {
          type: "array", minItems: 1, maxItems: CANVAS_CARD_ROWS_MAX,
          items: { type: "array", minItems: 2, maxItems: 2, items: cardText },
          description: "What you agreed with the person, a label and its value each: the project, the number of episodes and their length, the source, the format, the style.",
        },
        episodes: { type: "integer", minimum: 1, maximum: 500, description: "How many episodes the script bot adapts the source into." },
        source: {
          type: "object",
          additionalProperties: false,
          description: "The source the drama is adapted from, shown on your card. Left out when planning again, the source stays as it was.",
          properties: {
            title: cardText,
            author: cardText,
            tags: { type: "array", maxItems: 4, items: { type: "string", maxLength: 40 }, description: "Such as the genre, how many chapters, how long it is." },
            quote: { ...cardText, description: "One line from the source that carries its mood." },
            from: { ...cardText, description: "Where it came from, such as the TXT the person uploaded." },
            cover: { type: "string", maxLength: 500, description: "A cover picture's path in the project folder, if there is one." },
          },
          required: ["title"],
        },
        assignments: {
          type: "object",
          additionalProperties: false,
          description: "Who does each job. Left out, a job goes to the bot whose title names it. For storyboard and post, name the bot each episode's own bot is a copy of.",
          properties: { script: botRef, character: botRef, scene: botRef, storyboard: botRef, post: botRef },
        },
      },
      required: ["brief"],
    },
  },
];
