# Generation plugins: pictures and videos for a project

A project's pictures and videos are made by a **generation plugin**: a folder with a
`plugin.json` that declares its models and the HTTP requests that make them. A plugin
is installed once, for the whole installation, and every project may choose it.

This page is for the author of a plugin. The MCP convention it replaces for new
projects is [Pictures and videos for a project, through an MCP server](project-generation-mcp.md);
the model fields, the status words, the result files and the failures are the same,
so the two can be read together.

## Installing a plugin

**Settings → Pictures and videos**. Upload a zip of up to 8 MB holding
at most 200 files and 32 MB unpacked. `plugin.json` sits at the top of the zip, or in a
single folder at its top.

```
acme-images/
  plugin.json
  README.md            # anything else you ship, kept as it is
```

The plugin is stored under the data folder, in `plugins/<id>/`. Installing the same
`id` again replaces the folder and keeps the saved settings. Deleting a plugin in the
app deletes its folder, its settings and its key.

A plugin starts **on** but **not ready** until every required setting has a value.
Its models are read from the file on disk every time the app asks, so editing
`plugin.json` or its settings shows at once, without a restart.

## `plugin.json`

```json
{
  "schemaVersion": 1,
  "id": "acme-images",
  "name": "Acme Images",
  "version": "1.0.0",
  "description": "Pictures and videos from Acme.",
  "models": [
    { "id": "pixel-1", "name": "Pixel 1", "kind": "image",
      "aspects": ["1:1", "16:9", "9:16"], "qualities": ["standard", "hd"],
      "maxCount": 4, "referenceImages": true }
  ],
  "config": [
    { "key": "baseUrl", "label": "API address", "type": "url", "required": true,
      "default": "https://api.acme.test/v1" },
    { "key": "apiKey", "label": "API key", "type": "secret", "required": true }
  ],
  "requests": {
    "generate": {
      "method": "POST",
      "url": "{{config.baseUrl}}/images/generations",
      "headers": { "authorization": "Bearer {{config.apiKey}}" },
      "body": { "model": "{{model}}", "prompt": "{{prompt}}", "n": "{{count}}",
                "aspect_ratio": "{{aspect}}", "quality": "{{quality}}",
                "references": "{{referenceImages}}" },
      "answer": { "taskId": "task.id", "files": "data[].url", "error": "error.message" }
    },
    "status": {
      "method": "GET",
      "url": "{{config.baseUrl}}/tasks/{{taskId}}",
      "headers": { "authorization": "Bearer {{config.apiKey}}" },
      "answer": { "status": "state", "progress": "percent", "files": "output[].url",
                  "error": "failure.reason", "pollAfterSeconds": "retry_after" }
    },
    "cancel": {
      "method": "POST",
      "url": "{{config.baseUrl}}/tasks/{{taskId}}/cancel",
      "headers": { "authorization": "Bearer {{config.apiKey}}" }
    }
  },
  "statusMap": { "running": ["processing"], "succeeded": ["completed"] }
}
```

| Field | Required | Rule |
| --- | --- | --- |
| `schemaVersion` | yes | `1` |
| `id` | yes | 2–64 lowercase letters, digits, `-`; the folder's name |
| `name` | yes | up to 80 characters |
| `version` | yes | `x.y.z`, shown only |
| `description`, `author` | no | up to 300 and 120 characters |
| `models` | yes | 1–200, the `list_models` fields (Models below) |
| `config` | no | up to 40 fields (Settings below) |
| `requests.generate` | yes | one HTTP request |
| `requests.status` | when `generate` answers a task | one HTTP request |
| `requests.cancel` | no | one HTTP request |
| `statusMap` | no | words your API uses for the five statuses |

A request is `{ method, url, headers?, body?, answer }`. `method` is `GET`, `POST`,
`PUT`, `PATCH` or `DELETE` (default `POST`). Every string in `url`, `headers` and
`body` may hold a placeholder:

| Placeholder | What it is |
| --- | --- |
| `{{model}}`, `{{prompt}}`, `{{aspect}}` | this generation |
| `{{quality}}`, `{{count}}` | a picture: the quality and how many |
| `{{resolution}}`, `{{seconds}}` | a video: the resolution and its length |
| `{{taskId}}` | a task's id, in `status` and `cancel` |
| `{{referenceImages}}`, `{{referenceAudio}}` | `[{ name, mimeType, data }]`, base64, empty when none |
| `{{config.<key>}}` | a setting's value, a secret included |

A string that is exactly one placeholder keeps the value's type: `"n": "{{count}}"`
sends a number, `"references": "{{referenceImages}}"` sends the array. A placeholder
inside a longer string is filled as text.

`answer` says where each part is, as a path: `a.b`, `a[0].b`, `data[].url`. Files are
`"files": "data[].url"` (a list of addresses or base64 data), or
`{"items": "data", "url": "url", "data": "b64_json", "name": "name"}` for objects.
A `{{taskId}}` answer needs `requests.status`; a `succeeded` status needs files.

`statusMap` adds your words to the ones MagicBot knows (`pending` reads as queued,
`processing` as running, `completed` as succeeded, and so on; see the MCP page).
`progress` is 0–1 (above 1 reads as a percent). `pollAfterSeconds` or `pollAfterMs`
says when to ask again.

## Models

Exactly the fields `list_models` defines: `id`, `name`, `kind` (`image` or `video`),
and for a picture `aspects`, `qualities`, `maxCount` (1–10), `referenceImages`; for a
video `resolutions`, `aspects`, `durations`, `referenceImages`, `referenceAudio`. A
list left out or empty means the app's common choices, as on the MCP page.

## Settings

Each `config` field is one row in the app, generated from the file:

| `type` | Shown as | Stored as |
| --- | --- | --- |
| `text` | a text field | text |
| `url` | a text field, checked on save | https, or http on this computer |
| `secret` | a password field that only says “Saved” | `secrets.json`, mode 600 |
| `number` | a number field | number |
| `boolean` | a switch | true or false |
| `select` | a menu of `choices` | one of the choices |

`required`, `default`, `placeholder` and `help` are optional. A secret's value is
never returned to the app's screens, never written to a log, and never put into a
job or an error; it is used only to fill `{{config.<key>}}`.

## Security

- Addresses must be `https`, or `http` to this computer (`localhost`, a loopback
  address, `*.local`). No credentials, query or fragment in the address.
- Results are fetched only from a public `https` address or from the plugin's own
  origin, with no key, cookie or sign-in attached, and what they are comes from
  their bytes (PNG, JPEG, GIF, WebP; MP4, MOV, WebM).
- A refusal's words are masked (your address, headers and keys are replaced) and
  clipped to 300 characters before a person reads them.
- Plugins are **declarative only**: `plugin.json` is data, and no JavaScript in a
  plugin is run. An adapter that runs code would be an app installed with your
  permissions, and there is no sandbox on a desktop to make that safe; a plugin that
  needs code can ship a local MCP server instead (that page's convention).

## What this round does not do

No marketplace, no updates or version checks, no signature, no JavaScript adapter,
no settings per project.
