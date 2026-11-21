# Pictures and videos for a project, through an MCP server

A project's canvas makes pictures and videos through an MCP server the person
set up in **Apps → MCP servers**. MagicBot ships no image or video model of its
own here: it speaks one small convention, and any MCP server that follows it
can make a project's pictures, its videos, or both. This page is that
convention, written for the author of such a server.

This is not the chat's image generation, which uses an image provider's key
directly: see [Image generation](image-generation.md).

## How a project uses your server

A project's settings say, for pictures and for videos separately:

- which MCP server makes them;
- the name of each of the server's tools (the defaults below, or your own);
- a default model, and its default settings: for pictures the shape, the
  quality and how many; for videos the resolution, the shape and the length.

A node on the canvas inherits those and may change any of them for itself.
When it runs, MagicBot resolves the node's settings over the project's, checks
them against what the model says it offers, and hands them to your tool exactly
as resolved. The person's or bot's prompt reaches you exactly as written.

The person and the bots start generations the same way. A bot may start
8 pictures and 3 videos in any 24 hours without the person; past that, the
person confirms each one. A request for several pictures counts each picture.

## Which servers can be chosen

Any MCP server MagicBot can connect to: a URL (Streamable HTTP or SSE) or a
command. It must be turned on, run on this computer, serve every bot (not one
bot's own server), and be one account for the whole team (not a server each
person connects to with their own account). An organization's policy can also
rule a server out.

Your keys stay where every MCP server's keys are: in its saved headers or
environment, or in the Vault behind them, as the person entered them. They
never enter a project's settings, a job, a log line or an error message, and
MagicBot sends them only to your server: never with a download. A server that
signs in with OAuth is called with its sign-in, refreshed once when you refuse
it. A key from the Vault is read as the bot that asked, so a key the Vault
keeps from a bot is not used for that bot.

MagicBot is a plain MCP client here: `initialize`, `tools/list`, then
`tools/call`. It lists your tools before calling one, and refuses, by its name,
a tool the project's settings name but your server doesn't list.

## The tools

| Purpose | Default name | Needed |
| --- | --- | --- |
| List the models | `list_models` | always |
| Make pictures | `generate_image` | for pictures |
| Make a video | `generate_video` | for videos |
| Where a task is | `task_status` | when a generate tool answers a task |
| Cancel a task | `cancel_task` | no |

A project's settings may give each purpose another name, of up to 128 letters,
digits and `_ . : / -`. Pictures and videos each have their own names, and may
use different servers.

### Answers

Every answer is one JSON object. Put it in `structuredContent`, or as JSON in
the result's text content (all text blocks are joined before reading). An
answer with `isError: true`, or a JSON-RPC error, is a refusal: its text is
shown to the person as your reason, after MagicBot masks anything that looks
like the server's configured address, headers or environment, or like a
secret, and clips it to 300 characters. Say what went wrong in words a person
can act on: "the prompt was refused by the safety filter", "the account is out
of credit".

### `list_models`

Called with `{}`. Answer the models, up to 200:

```json
{
  "models": [
    {
      "id": "pixel-1",
      "name": "Pixel 1",
      "kind": "image",
      "aspects": ["1:1", "16:9", "9:16"],
      "qualities": ["standard", "hd"],
      "maxCount": 4,
      "referenceImages": true
    },
    {
      "id": "motion-1",
      "name": "Motion 1",
      "kind": "video",
      "resolutions": ["720p", "1080p"],
      "aspects": ["16:9", "9:16"],
      "durations": [5, 10],
      "referenceImages": true,
      "referenceAudio": true
    }
  ]
}
```

- `id` and `kind` (`image` or `video`) are required; `name` is what the person
  sees, `id` when left out.
- A picture model may say `aspects`, `qualities`, `maxCount` (pictures per
  call, at most 10) and `referenceImages`. A video model may say
  `resolutions`, `aspects`, `durations` (seconds), `referenceImages` and
  `referenceAudio`. Anything else is ignored.
- Each list holds up to 50 entries. A list left out or empty means the common
  choices: shapes `1:1 2:3 3:2 3:4 4:3 9:16 16:9 21:9` for pictures and
  `16:9 9:16 1:1 4:3 3:4 21:9` for videos, qualities `auto low medium high`,
  1 to 4 pictures, resolutions `480p 720p 1080p`, and 5 or 10 seconds.
- `referenceImages` and `referenceAudio` are false unless they are `true`.

A setting a model doesn't offer is refused when the person saves it and again
when a generation starts, with what the model does offer, so your generate
tools are never called with one. MagicBot keeps your list for 5 minutes.

### `generate_image`

Called with:

```json
{
  "model": "pixel-1",
  "prompt": "a lighthouse at dusk",
  "referenceImages": [{ "name": "face.png", "mimeType": "image/png", "data": "<base64>" }],
  "aspect": "16:9",
  "quality": "hd",
  "count": 2
}
```

Answer with the pictures, if you make them within the call:

```json
{ "files": [{ "url": "https://cdn.example.com/a.png", "name": "a.png", "mimeType": "image/png" }] }
```

or with MCP `image` content blocks, or with a task to follow:

```json
{ "taskId": "task-1234", "status": "queued" }
```

(`task_id` is read too). One call may take up to 10 minutes; answer a task for
anything slower.

### `generate_video`

Called with:

```json
{
  "model": "motion-1",
  "prompt": "waves against the lighthouse",
  "referenceImages": [],
  "referenceAudio": [{ "name": "voice.mp3", "mimeType": "audio/mpeg", "data": "<base64>" }],
  "resolution": "720p",
  "aspect": "16:9",
  "seconds": 5
}
```

Answer with a task, as above, or with the files if the video is already made.

### `task_status`

Called with `{ "taskId": "task-1234" }`. Answer where the task is:

```json
{ "taskId": "task-1234", "status": "running", "progress": 0.4, "pollAfterMs": 2000 }
```

```json
{ "taskId": "task-1234", "status": "succeeded", "files": [{ "url": "https://cdn.example.com/v.mp4" }] }
```

```json
{ "taskId": "task-1234", "status": "failed", "error": "the prompt was refused by the safety filter" }
```

- `status` is one of `queued`, `running`, `succeeded`, `failed` or `cancelled`,
  in any case. Common other words are read as these: `pending`, `submitted`
  and `waiting` as queued; `processing`, `in_progress`, `generating` and
  `started` as running; `success`, `completed`, `complete`, `done` and
  `finished` as succeeded; `failure` and `error` as failed; `canceled` as
  cancelled.
- `succeeded` comes with the files. `failed` comes with `error`, `reason` or
  `message`, shown to the person as your reason.
- `progress` is a fraction from 0 to 1 (a number above 1 is read as a percent).
- `pollAfterMs` says when to ask again. MagicBot asks every 3 seconds unless
  told otherwise, never more often than every half second, and never waits
  more than 30 seconds.
- A status MagicBot doesn't know, or `succeeded` without files, fails the
  generation as an answer MagicBot can't read. When `task_status` itself
  fails (an error answer, or no answer), MagicBot asks again; after 5 failures
  in a row it gives up.

A task id must stay good until its task is over, and `task_status` must answer
it on any connection: MagicBot keeps the id, and when it starts again after
quitting or a crash, it asks about the task again and finishes the generation.
A generation MagicBot was still handing over when it stopped (its generate
call had no answer yet) is reported as interrupted, because MagicBot can't
know whether it started: the person tries again.

A picture task gets 15 minutes and a video task 60, counted from when it was
handed over. After that MagicBot cancels it and says it got no result.

### `cancel_task`

Called with `{ "taskId": "task-1234" }` when the person cancels a generation
or its time runs out. Any answer will do. Without this tool, a cancelled task
is left to finish on your side and its result is not fetched.

## Files

A file is `{ "url": "…" }` or `{ "data": "<base64>" }`, each with an optional
`name` and `mimeType`; up to 10 per answer.

- A `url` must be public `https`, or on your MCP server's own address (the
  same scheme, host and port as the address MagicBot connects to). Any other
  address on this computer or a private network is refused. A redirect may
  lead to a public address or to your server's own host, and nowhere else.
  MagicBot sends no credentials with the download: no key, no cookie, no
  sign-in.
- What a file is comes from its bytes: PNG, JPEG, GIF or WebP for pictures,
  MP4, MOV or WebM for videos. `mimeType` is only a hint. A picture may be up
  to 40 MB and is fetched within 2 minutes; a video up to 200 MB within 10.
- MagicBot saves each result in the project's folder, in `产出/图片` or
  `产出/视频`, named after the node, the time and the generation, with `-2`,
  `-3` for further pictures. It never replaces a file there, and saves
  nothing when a part of that path is a link.

## References

The files a node chose as references are sent inline, as `{ name, mimeType,
data }` with the type read from their bytes. `referenceImages` and
`referenceAudio` are always there, empty when the node chose none. A node may
send up to 8 pictures of up to 10 MB each and 2 audio files of up to 20 MB
each, 40 MB in all. A model that doesn't take references of a kind is never
sent any: the node is refused first. References are read only from real
folders and files inside the project's folder.

## Load

MagicBot runs at most 4 generations at once on one server; the rest wait their
turn. A project holds at most 50 generations waiting or running.

## Trying it out

`server/testing/fake-generation-mcp-server.ts` follows this convention with
two picture and two video models that offer different things, and makes small
real PNG and MP4 files after a delay. Run it with
`node server/testing/fake-generation-mcp-server.ts --key <key>`: it prints its
address, which you add in **Apps → MCP servers** with the header
`Authorization: Bearer <key>`. Words in square brackets in a prompt steer it:
`[hold]` keeps a task running until `POST /control/release`, `[fail:reason]`
fails it with that reason, `[refuse:reason]` refuses the call, `[task]` makes
pictures through a task, `[inline]` answers base64 data, and `[image-block]`
answers MCP image blocks.
