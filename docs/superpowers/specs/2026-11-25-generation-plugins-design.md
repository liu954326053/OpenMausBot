# 图片与视频生成插件系统

今天，一个项目的图片和视频由一个 MCP 服务器按
[`docs/project-generation-mcp.md`](../../project-generation-mcp.md) 的小约定来制作。
这份约定不变，但它的“服务器”换成了可安装的**生成插件**：一个目录，`plugin.json` 声明模型与
HTTP 请求映射，配置在插件管理页里改、保存即生效。

## 1. 目录与标识

插件装在全局数据目录，不在仓库里，也不按项目分：

```
<dataDir>/plugins/
  state.json                 # 每个插件是否启用
  config.json                # 每个插件的非密钥配置
  secrets.json               # 每个插件的密钥，0600，永不出现在任何读取里
  acme-images/
    plugin.json
    （插件自带的其它文件，原样保留）
```

- 目录名是 `plugin.json` 的 `id`，`^[a-z0-9][a-z0-9-]{1,63}$`。装一个已在的 id 是**替换**，旧目录整体换掉。
- 安装只接受 zip（≤ 8 MB，≤ 200 个文件，解压后 ≤ 32 MB），解压时拒绝绝对路径、`..`、盘符、
  符号链接与其它文件类型，只落在一个新建的暂存目录里，校验通过后才改名进 `plugins/`。
- 删除插件连同它的配置与密钥一起删除。

`plugin.json` 的完整 schema（每个字段都可校验，未知字段忽略、**不**报错，便于插件向前兼容）：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `schemaVersion` | 是 | 必须是 `1` |
| `id` | 是 | 见上；与目录名一致 |
| `name` | 是 | 1–80 字符，给人看的名字 |
| `version` | 是 | `x.y.z`，只用于展示 |
| `description` | 否 | ≤ 300 字符 |
| `author` | 否 | ≤ 120 字符 |
| `models` | 是 | 1–200 个，见 §2 |
| `config` | 否 | ≤ 40 个字段，见 §5 |
| `baseUrl` | 否 | 可选默认地址，`https`，或本机 `http` |
| `requests.generate` | 是 | 见 §3 |
| `requests.status` | 否 | 生成直接返回文件时不需要 |
| `requests.cancel` | 否 | 取消时顺带通知插件 |
| `statusMap` | 否 | 把插件自己的状态词映射到五个标准状态 |

## 2. 能力声明

`models` 的字段与 `list_models` 的工具答案**逐字相同**（`id`、`name`、`kind`、`aspects`、
`qualities`、`maxCount`、`resolutions`、`durations`、`referenceImages`、`referenceAudio`），
校验也相同：每个列表 ≤ 50 项，`maxCount` 1–10，空列表等于没写、回落到公共选项
（`COMMON_CHOICES`）。这样插件、MCP 服务器和项目设置共用一套 `GenerationModel` 与
`settingProblems`，不另造模型语义。

模型列表在**每次**读取时从磁盘上当前的 `plugin.json` 解析（按 mtime 失效），没有 TTL 缓存；
装完、改完配置、改完文件都立刻反映。

## 3. 接口映射

一个请求声明 method、URL、headers、body 与答案的取值路径。

- URL 与 headers 是字符串模板，body 是 JSON 模板。
- `{{model}} {{prompt}} {{aspect}} {{quality}} {{count}} {{resolution}} {{seconds}} {{taskId}}`
  是本次生成的参数；`{{config.apiKey}}` 是配置值（密钥只在服务端解析）。
- `{{referenceImages}}`、`{{referenceAudio}}` 展开成 `{name, mimeType, data}` 数组。
- 整个字符串恰好是一个占位符时保留原 JSON 类型（数字仍是数字、数组仍是数组），否则做字符串插值。
- 答案路径是极小的 JSON 路径：`a.b`、`a[0].b`、`data[].url`。文件可以用
  `"files": "data[].url"`，或 `{"items":"data","url":"url","data":"b64_json","name":"name"}`。

示例（一个通用 HTTP 图片插件，读起来就是它会发出的请求）：

```json
{
  "schemaVersion": 1,
  "id": "acme-images",
  "name": "Acme Images",
  "version": "1.0.0",
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
      "headers": { "authorization": "Bearer {{config.apiKey}}", "content-type": "application/json" },
      "body": {
        "model": "{{model}}", "prompt": "{{prompt}}", "n": "{{count}}",
        "aspect_ratio": "{{aspect}}", "quality": "{{quality}}",
        "references": "{{referenceImages}}"
      },
      "answer": { "taskId": "task.id", "files": "data[].url", "status": "status", "error": "error.message" }
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

错误沿用现有 MCP 语义：非 2xx、`answer.error` 或超时都是可读原因，先掩码再截到 300 字符；
插件自己的地址、headers 与密钥不会出现在原因里。HTTP 只允许 `https`，本机地址允许 `http`
（与图片生成的自定义网关同一规则）。生成请求 10 分钟，状态请求 30 秒，答案 ≤ 64 MB。

## 4. JS 适配器：这轮不做

**结论：只允许 JSON 声明 + 受限模板，不执行插件里的 JavaScript。**

理由：桌面端没有可用的沙箱。Node 的 `vm` 不是安全边界，`worker_threads` 与主进程共享文件系统、
环境与网络，一个被安装的适配器就等于“安装了一个能读 Vault 的应用”。而这条插件链路上唯一真正
需要代码的场景（签名算法、奇怪的嵌套答案）在声明式里用“取值路径 + 状态映射”已经能覆盖绝大多数
供应商；覆盖不了的，写一个本地 MCP 服务器仍然可用（§6 保留这条路）。

如果以后要做，最小约束写在这里，作为那时评审的起点：适配器在独立进程、独立临时目录里运行，
只拿到本次请求的参数与它自己的配置，拿不到 Vault、数据目录和网络以外的东西；每次调用有硬超时；
失败只回传一句可读的原因；安装时明确告诉人“这等同安装应用”。

## 5. 配置与实时生效

- `config.json`：`{ "<pluginId>": { "<key>": <string|number|boolean> } }`，密钥之外的一切。
- `secrets.json`：同样的结构，权限 0600；读取接口只回 `{ key, set: true }`，值只用于拼请求。
- `state.json`：`{ "<pluginId>": { "enabled": true } }`。
- 三个文件都经 `writeFileAtomic` 写，写后把插件注册表的代次加一；注册表按代次 + 目录 mtime
  失效，所以运行中的服务下一次请求就读到新配置，不用重启。
- 模型列表不缓存（§2），项目设置页打开就向服务端要一次。

## 6. 生成链路

- `shared/project-generation.ts`：`GenerationKindSettings` 增加 `plugin: string | null`；
  `server` 与 `tools` 保留给旧项目。**选了插件就清空 `server`，选了服务器就清空 `plugin`。**
- 服务端的项目生成按 `plugin` 走插件，否则按 `server` 走原来的 MCP 约定；`GenerationJob` 增加
  可选的 `plugin`，旧任务没有它就是 MCP 任务，重启后照旧恢复。
- 迁移：读旧设置时补 `plugin: null` 并保留 `server`；旧项目继续生成，不报错、不静默失效。
  数据格式只新增文件与新可选字段，旧版本读到未知字段会丢弃，因此 `DATA_FORMAT` 不变。
- 结果下载沿用 `resultBytes`：公开 https，或插件自己的地址；不携带任何密钥。

## 7. 聊天里的图片生成：选“插件优先，旧供应商保留”

老板那句“不用合并，直接调整成走插件的渠道”有两种合理解读：

1. 把聊天图片也改成走插件，删掉现有的图片供应商设置；
2. 不合并两套设置，但让聊天图片**可以**走插件这条渠道。

选 2，并让插件在配置好后**优先**：`generate_image` 先看已启用、已配置的图片插件，有就用它；
没有就完全按今天的方式走 OpenAI/Grok/Gemini/OpenRouter/Higgsfield/自定义。原因：删掉供应商会让
所有现存用户的图片立刻失效，也会破坏“备份供应商”“只给本人”等既有保护；而“优先”满足“走插件
渠道”，又不改变任何没有装插件的人的体验。影响面是 `server/image-generation.ts` 的入口与它的错误
文案；编辑图片（`edit_image`）仍只走 OpenAI。

## 8. UI

- 插件管理放在 **Apps 面板**里，作为与 MCP 并列的“插件”视图（不新开一个应用级入口，遵循
  `DESIGN.md` §2）。列表显示名字、版本、种类、启用开关、配置状态；空状态一行话 + “上传插件”。
- 上传是文件选择（`.zip`），选中即上传；失败在列表上方一行可读原因。
- 配置表单由 `plugin.json` 的 `config` 生成：`text`/`url`/`secret`/`number`/`boolean`/`select`；
  密钥字段只显示“已保存”，留空则不改。
- 保存后就地显示“已保存，立即生效”，模型选择与项目设置的下一次读取立刻是新值。
- 项目设置：每个种类先选“生成插件”，或“不用插件（MCP 服务器）”；选插件时只列插件里的模型与
  该模型支持的选项。

## 9. 这轮不做

插件市场、在线更新与版本升级、签名校验、插件里的 JS 适配器、视频以外的其它生成种类、按项目分
插件配置、插件之间的依赖。
