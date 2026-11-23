// Every production board card in each of its states on one page, for screenshots: it wears the midnight skin unless
// ?skin= names another, speaks ?lang= (Chinese by default, as the owner's mockup does), and ?only=<section> shows one
// section. Pictures are painted and videos recorded in the page, so the preview needs no server and no files.
import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { CanvasBotState } from "../../shared/project-canvas";
import {
  BoardFarLabel, BotCard, BriefCard, CharacterCard, EpisodeCard, EpisodeStackCard, FinalCard, GenericCard, PlanCard,
  ResultCard, SceneCard, ShotCard, type BoardCardKind, type BoardTone, type FinalClip, type PlanTask,
} from "../../src/components/production-board/cards";
import { loadLocale } from "../../src/lib/i18n";
import type { CanvasBotLook } from "../../src/lib/project-canvas/types";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.skin = params.get("skin") ?? "midnight";
await loadLocale(params.get("lang") ?? "zh");

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext("2d")!];
}

function paintHarbour(context: CanvasRenderingContext2D, width: number, height: number, hue: number, time: number) {
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsl(${hue} 40% 14%)`);
  sky.addColorStop(0.6, `hsl(${hue + 20} 35% 30%)`);
  sky.addColorStop(1, `hsl(${hue + 30} 30% 18%)`);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  context.fillStyle = `hsl(${hue} 30% 9%)`;
  context.fillRect(0, height * 0.68, width, height * 0.32);
  context.fillRect(width * 0.62, height * 0.3, width * 0.015, height * 0.4);
  const glow = context.createRadialGradient(width * 0.628, height * 0.3, 2, width * 0.628, height * 0.3, height * 0.22);
  glow.addColorStop(0, "hsl(200 90% 80% / 0.95)");
  glow.addColorStop(1, "hsl(200 90% 60% / 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  for (let band = 0; band < 3; band += 1) {
    context.fillStyle = `hsl(${hue} 20% 80% / 0.08)`;
    const y = height * (0.55 + band * 0.08);
    context.fillRect(((time * 60 + band * 140) % (width + 200)) - 200, y, width * 0.7, height * 0.05);
  }
}

function paintPortrait(hue: number): string {
  const [canvas, context] = canvasOf(300, 400);
  const ground = context.createLinearGradient(0, 0, 0, 400);
  ground.addColorStop(0, `hsl(${hue} 30% 22%)`);
  ground.addColorStop(1, `hsl(${hue + 25} 35% 38%)`);
  context.fillStyle = ground;
  context.fillRect(0, 0, 300, 400);
  context.fillStyle = `hsl(${hue} 35% 48%)`;
  context.beginPath();
  context.ellipse(150, 420, 130, 150, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = `hsl(${hue - 10} 25% 76%)`;
  context.beginPath();
  context.arc(150, 165, 62, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL("image/png");
}

function paintScene(hue: number): string {
  const [canvas, context] = canvasOf(640, 360);
  paintHarbour(context, 640, 360, hue, 0);
  return canvas.toDataURL("image/png");
}

async function recordVideo(hue: number, seconds: number): Promise<string> {
  const [canvas, context] = canvasOf(640, 360);
  const started = performance.now();
  const draw = () => paintHarbour(context, 640, 360, hue, (performance.now() - started) / 1000);
  draw();
  const recorder = new MediaRecorder(canvas.captureStream(24), { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const timer = setInterval(draw, 1000 / 24);
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  recorder.stop();
  clearInterval(timer);
  await stopped;
  return URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
}

const PORTRAITS = { qingwu: paintPortrait(210), laoyan: paintPortrait(30), axiu: paintPortrait(330) };
const SCENES = { pier: paintScene(215), tower: paintScene(260), market: paintScene(20) };
const [TAKE_ONE, TAKE_TWO, FILM] = [await recordVideo(215, 1), await recordVideo(250, 1), await recordVideo(190, 1.2)];

const LOOKS: Record<string, CanvasBotLook> = {
  lead: { color: "purple" }, script: { color: "blue" }, character: { color: "coral" }, scene: { color: "teal" },
  storyboard: { color: "green" }, post: { color: "yellow" },
};

const bot = (patch: Partial<CanvasBotState> & Pick<CanvasBotState, "botId" | "name" | "title">): CanvasBotState =>
  ({ lead: false, stages: ["other"], status: "idle", placed: true, ...patch });

const at = (hour: number, minute: number) => new Date(2026, 10, 24, hour, minute).getTime();

const LONG = "这是一段故意写得很长很长的文字，用来看卡片在内容超出时是否会在卡内截断，而不是把卡片撑大或者溢出到画板上";

const STEPS = [
  { text: "读完创作需求单", state: "done" as const, at: at(10, 2) },
  { text: "把原著拆成 60 集", state: "done" as const, at: at(10, 9) },
  { text: "写完 EP01 – EP12 剧本", state: "done" as const, at: at(10, 41) },
  { text: "正在写 EP13", state: "working" as const, at: at(10, 52) },
  { text: "写 EP14 – EP60", state: "waiting" as const },
];

const PLAN: PlanTask[] = [
  { job: "script", status: "done", bot: { name: "墨白", look: LOOKS.script }, count: 60 },
  { job: "character", status: "done", bot: { name: "云舟", look: LOOKS.character }, count: 4 },
  { job: "scene", status: "failed", bot: { name: "青禾", look: LOOKS.scene } },
  { job: "storyboard", status: "working", bot: { name: "境川", look: LOOKS.storyboard } },
  { job: "post", status: "waiting", bot: { name: "剪秋", look: LOOKS.post } },
];

const SCRIPT = "第一场 旧码头 夜 外\n雾压在水面上，十年没亮过的灯一盏一盏黑着。\n青梧提着一盏蓝灯走上栈桥，把灯挂上锈住的铁钩。\n青梧：再撑一夜。";

const CLIPS = (ready: number, total: number): FinalClip[] =>
  Array.from({ length: total }, (_, index) => ({ number: index + 1, state: index < ready ? "ready" : index === ready ? "generating" : "missing" }));

const SHOT_DESIGN = { size: "近景", move: "缓推", audio: "青梧：再撑一夜。（远处汽笛）" };
const REFERENCES = [
  { kind: "character" as const, name: "青梧", pictureUrl: PORTRAITS.qingwu },
  { kind: "character" as const, name: "老严", pictureUrl: PORTRAITS.laoyan },
  { kind: "scene" as const, name: "旧码头", pictureUrl: SCENES.pier },
];

const noop = () => {};

function Shown({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      {children}
      <figcaption className="text-[12px] leading-4 text-ink-tertiary">{caption}</figcaption>
    </figure>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const only = params.get("only");
  if (only && only !== id) return null;
  return (
    <section data-preview-section={id} className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-ink-secondary">{title}</h2>
      <div className="flex flex-wrap items-start gap-6">{children}</div>
    </section>
  );
}

const FAR: Array<{ kind: BoardCardKind; name: string; tone: BoardTone; status: string }> = [
  { kind: "bot", name: "砚青", tone: "working", status: "工作中" },
  { kind: "bot", name: "境川 EP01", tone: "asking", status: "等你回答" },
  { kind: "bot", name: "青禾", tone: "failed", status: "失败" },
  { kind: "episode", name: "EP01 守灯人", tone: "done", status: "已完成" },
  { kind: "shot", name: "SH03 点灯", tone: "idle", status: "未开始" },
];

function FarView({ zoom }: { zoom: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline" style={{ width: 760, height: 200 }}>
      <div className="flex origin-top-left gap-[160px] p-[120px]" style={{ transform: `scale(${zoom})`, width: 760 / zoom }}>
        {FAR.map((label) => <BoardFarLabel key={label.name} kind={label.kind} name={label.name} tone={label.tone} zoom={zoom} statusLabel={label.status} />)}
      </div>
    </div>
  );
}

function Preview() {
  const [selected, setSelected] = useState("t2");
  const takes = [
    { id: "t1", videoUrl: TAKE_ONE, durationMs: 5000, selected: selected === "t1" },
    { id: "t2", videoUrl: TAKE_TWO, durationMs: 5200, selected: selected === "t2" },
    { id: "t3", videoUrl: TAKE_ONE, durationMs: 4800, selected: selected === "t3" },
  ];
  return (
    <main className="flex min-h-screen flex-col gap-10 bg-app p-8 text-ink">
      <Section id="bots" title="Bots">
        <Shown caption="lead, working, steps">
          <BotCard bot={bot({ botId: "lead", name: "砚青", title: "负责人", lead: true, stages: ["lead"], status: "working", doing: "核对 EP01 的分镜" })} look={LOOKS.lead} progress={{ kind: "tasks", done: 3, total: 5 }} steps={STEPS.slice(0, 4)} onOpen={noop} />
        </Shown>
        <Shown caption="script, working, steps">
          <BotCard bot={bot({ botId: "script", name: "墨白", title: "编剧", stages: ["script"], status: "working", doing: "写 EP13 剧本" })} look={LOOKS.script} job="script" task="working" progress={{ kind: "episodes", done: 12, total: 60 }} steps={STEPS} onOpen={noop} />
        </Shown>
        <Shown caption="character, done">
          <BotCard bot={bot({ botId: "character", name: "云舟", title: "角色设计", stages: ["character"], output: { text: "四个角色的设定和定妆图都放在画板上了：青梧、老严、阿秀、沈先生。阿秀的定妆图我多做了一版，你可以挑一张。", threadId: "t", messageId: "m", at: at(10, 30) } })} look={LOOKS.character} job="character" task="done" progress={{ kind: "characters", done: 4, total: 4 }} onOpen={noop} />
        </Shown>
        <Shown caption="scene, failed">
          <BotCard bot={bot({ botId: "scene", name: "青禾", title: "场景设计", stages: ["scene"] })} look={LOOKS.scene} job="scene" task="failed" progress={{ kind: "scenes", done: 2, total: 5 }} onOpen={noop} onRetry={noop} />
        </Shown>
        <Shown caption="episode bot, waiting on you">
          <BotCard bot={bot({ botId: "jc-ep01", name: "境川 EP01", title: "分镜师", stages: ["storyboard"], episode: 1, status: "waiting", waiting: { threadId: "t", messageId: "m", card: { title: "SH05 用哪一版？", subtitle: "", options: ["V1", "V2"] } } })} look={LOOKS.storyboard} job="storyboard" task="working" progress={{ kind: "videos", done: 4, total: 6 }} onOpen={noop} />
        </Shown>
        <Shown caption="episode bot, not started">
          <BotCard bot={bot({ botId: "jq-ep01", name: "剪秋 EP01", title: "后期", stages: ["post"], episode: 1 })} look={LOOKS.post} job="post" task="waiting" onOpen={noop} />
        </Shown>
        <Shown caption="no job, no look">
          <BotCard bot={bot({ botId: "otto", name: "Otto", title: "Operations", output: { text: "Backed up the project folder at 10:00.\nNothing else to do.", threadId: "t", messageId: "m", at: at(10, 0) } })} onOpen={noop} />
        </Shown>
        <Shown caption="long text">
          <BotCard bot={bot({ botId: "long", name: `${LONG} EP12`, title: LONG, stages: ["storyboard"], episode: 12, status: "working", doing: LONG })} look={LOOKS.storyboard} job="storyboard" task="working" progress={{ kind: "videos", done: 1, total: 24 }} steps={[{ text: LONG, state: "working", at: at(11, 5) }]} onOpen={noop} />
        </Shown>
      </Section>

      <Section id="documents" title="Brief, plan and episodes">
        <Shown caption="brief">
          <BriefCard rows={[["项目", "《雾港灯塔》改编漫剧"], ["集数", "60 集，每集约 40 秒"], ["画幅", "16:9，1080p"], ["风格", "冷色调写实，雾和灯光是主角"], ["受众", "18–30 岁，悬疑爱好者"], ["交付", "每集一条成片和剪映草稿"]]} by="砚青" at={at(10, 12)} onOpen={noop} />
        </Shown>
        <Shown caption="brief, long values, scrolls">
          <BriefCard rows={Array.from({ length: 9 }, (_, index) => [`第 ${index + 1} 项`, LONG] as [string, string])} by="砚青" onOpen={noop} />
        </Shown>
        <Shown caption="brief, text only">
          <BriefCard rows={[]} text={SCRIPT} onOpen={noop} />
        </Shown>
        <Shown caption="plan">
          <PlanCard tasks={PLAN} onOpen={noop} />
        </Shown>
        <Shown caption="plan, nobody yet">
          <PlanCard tasks={PLAN.map(({ job }) => ({ job, status: "waiting" }))} onOpen={noop} />
        </Shown>
        <Shown caption="episode, making videos">
          <EpisodeCard episode={{ episode: 1, nodeId: "ep1", title: "守灯人", status: "videos", shots: 6, ready: 4, generating: 1, failed: 0 }} logline="十年没亮过的港口灯塔，被一个女孩重新点亮。" text={SCRIPT} to={{ name: "境川 EP01", look: LOOKS.storyboard }} onOpen={noop} />
        </Shown>
        <Shown caption="episode, failed">
          <EpisodeCard episode={{ episode: 2, nodeId: "ep2", title: "账本", status: "failed", shots: 5, ready: 2, generating: 0, failed: 1 }} logline="钟楼下藏着一本旧账。" text={SCRIPT} to={{ name: "境川 EP02", look: LOOKS.storyboard }} onOpen={noop} onRetry={noop} />
        </Shown>
        <Shown caption="episode, before production">
          <EpisodeCard episode={{ episode: 3, title: "第二盏蓝灯" }} onOpen={noop} />
        </Shown>
        <Shown caption="episode, long text">
          <EpisodeCard episode={{ episode: 12, nodeId: "ep12", title: LONG, status: "done", shots: 24, ready: 24, generating: 0, failed: 0 }} logline={LONG + LONG} text={`${SCRIPT}\n`.repeat(6)} to={{ name: LONG, look: LOOKS.storyboard }} onOpen={noop} />
        </Shown>
        <Shown caption="episode stack">
          <EpisodeStackCard first={4} last={60} count={57} titles={[{ episode: 4, title: "钟楼下的账本" }, { episode: 5, title: "第二盏蓝灯" }, { episode: 6, title: "行会的晚宴" }, { episode: 60, title: "雾散了" }]} statuses={{ done: 12, storyboard: 3, waiting: 41, failed: 1 }} onOpen={noop} />
        </Shown>
      </Section>

      <Section id="assets" title="Characters and scenes">
        <Shown caption="character">
          <CharacterCard name="青梧" facts={{ badge: "女主", subtitle: "24 岁 · 守灯人", tags: ["倔强", "心软", "怕水"], rows: [["外形", "灰色旧大衣，提一盏蓝灯"], ["声音", "低，说话快"]], palette: ["#2f3e4e", "#9fc3e6", "#d9d2c5"] }} pictureUrl={PORTRAITS.qingwu} shots={[{ episode: 1, number: 1 }, { episode: 1, number: 3 }, { episode: 1, number: 5 }]} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="character, making its picture">
          <CharacterCard name="老严" facts={{ badge: "配角", subtitle: "61 岁 · 港务员", tags: ["寡言"] }} generation={{ status: "loading" }} shots={[{ episode: 1, number: 2 }]} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="character, no picture yet">
          <CharacterCard name="阿秀" facts={{ subtitle: "17 岁 · 卖花女" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="character, picture failed">
          <CharacterCard name="阿秀" facts={{ subtitle: "17 岁 · 卖花女" }} generation={{ status: "error", errorKey: "serverError.projectGeneration.noImageServer", errorDetails: "No image server" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="character, long text">
          <CharacterCard name={LONG} facts={{ badge: "主角", subtitle: LONG, tags: [LONG, "倔强", "心软", "怕水", "夜行", "左撇子"], rows: [["外形", LONG], ["声音", LONG], ["口头禅", LONG]] }} pictureUrl={PORTRAITS.axiu} shots={Array.from({ length: 14 }, (_, index) => ({ episode: 1 + (index % 3), number: index + 1 }))} onOpen={noop} />
        </Shown>
        <Shown caption="scene, refined">
          <SceneCard name="旧码头" facts={{ subtitle: "夜 · 外 · 浓雾", tags: ["外景", "雾"] }} pictureUrl={SCENES.pier} shots={[{ episode: 1, number: 1 }, { episode: 1, number: 3 }]} refinedBy="境川 EP01" onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="scene, making a new picture">
          <SceneCard name="灯塔顶层" facts={{ subtitle: "夜 · 内" }} pictureUrl={SCENES.tower} generation={{ status: "loading" }} shots={[{ episode: 2, number: 4 }]} onOpen={noop} />
        </Shown>
        <Shown caption="scene, no picture yet">
          <SceneCard name="鱼市" facts={{ subtitle: "清晨 · 外" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="scene, picture failed">
          <SceneCard name="鱼市" facts={{ subtitle: "清晨 · 外" }} generation={{ status: "error", errorDetails: "The image model refused the prompt" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="scene, long text">
          <SceneCard name={LONG} facts={{ subtitle: LONG, tags: [LONG, "外景"] }} pictureUrl={SCENES.market} shots={Array.from({ length: 12 }, (_, index) => ({ episode: 1 + (index % 4), number: index + 1 }))} refinedBy={LONG} onOpen={noop} />
        </Shown>
      </Section>

      <Section id="shots" title="Shots">
        <Shown caption="no video yet">
          <ShotCard number={3} episode={1} title="青梧点灯" design={SHOT_DESIGN} seconds={5} prompt="她拧动铜钥匙，火苗窜起，整片雾被染成蓝色。" references={REFERENCES} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="generating">
          <ShotCard number={4} episode={1} title="老严在窗后" design={{ size: "中景", move: "固定" }} seconds={4} prompt="港务所的窗后，老严放下望远镜。" references={REFERENCES.slice(1)} generation={{ status: "loading" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="video ready">
          <ShotCard number={5} episode={1} title="灯光扫过海面" design={{ size: "远景", move: "横摇", audio: "海浪，低沉的弦乐" }} seconds={6} prompt="灯塔的光柱扫过海面，照出一艘没有灯的船。" references={REFERENCES.slice(2)} takes={2} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="failed">
          <ShotCard number={6} episode={1} title="船靠岸" design={SHOT_DESIGN} seconds={5} prompt="船靠上栈桥，船上没有人。" generation={{ status: "error", errorKey: "serverError.projectGeneration.noVideoServer", errorDetails: "No video server" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="long text, no description">
          <ShotCard number={12} episode={1} title={LONG} design={{ size: LONG, move: LONG, audio: LONG }} seconds={12} references={[{ kind: "character", name: "Qingwu" }, { kind: "scene", name: "Old pier" }]} onOpen={noop} onGenerate={noop} />
        </Shown>
      </Section>

      <Section id="results" title="Results">
        <Shown caption="three takes, one selected (switch and select work)">
          <ResultCard number={3} title="青梧点灯" takes={takes} onOpen={noop} onGenerate={noop} onPlay={noop} onSelectTake={setSelected} />
        </Shown>
        <Shown caption="first take generating">
          <ResultCard number={4} title="老严在窗后" takes={[]} generation={{ status: "loading" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="another take generating">
          <ResultCard number={5} title="灯光扫过海面" takes={[{ id: "a", videoUrl: TAKE_TWO, durationMs: 6000, selected: true }]} generation={{ status: "loading" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="failed, no take">
          <ResultCard number={6} title="船靠岸" takes={[]} generation={{ status: "error", errorKey: "serverError.projectGeneration.noVideoServer", errorDetails: "No video server" }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="failed again, earlier take kept">
          <ResultCard number={7} title="雾里的人影" takes={[{ id: "b", videoUrl: TAKE_ONE, durationMs: 4000 }]} generation={{ status: "error", errorDetails: "The video model is busy, try again in a minute" }} onOpen={noop} onGenerate={noop} onSelectTake={noop} />
        </Shown>
        <Shown caption="no take yet">
          <ResultCard number={8} title="收灯" takes={[]} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="long title, five takes">
          <ResultCard number={12} title={LONG} takes={Array.from({ length: 5 }, (_, index) => ({ id: `l${index}`, videoUrl: TAKE_ONE, durationMs: 5000 }))} onOpen={noop} onGenerate={noop} onSelectTake={noop} />
        </Shown>
      </Section>

      <Section id="finals" title="Films">
        <Shown caption="waiting for shots, draft not written">
          <FinalCard episode={1} title="守灯人" clips={CLIPS(4, 6)} draft={{ state: "none", exportFolder: "/tmp/out" }} onOpen={noop} onOpenDraft={noop} />
        </Shown>
        <Shown caption="film ready, draft written">
          <FinalCard episode={2} title="账本" videoUrl={FILM} durationMs={41_000} clips={CLIPS(8, 8)} draft={{ state: "written", name: "雾港灯塔 EP02", writtenAt: at(11, 30), exportFolder: "/tmp/out" }} onOpen={noop} onPlay={noop} onOpenDraft={noop} />
        </Shown>
        <Shown caption="cover only, draft kept beside JianYing's copy">
          <FinalCard episode={3} title="第二盏蓝灯" coverUrl={SCENES.tower} durationMs={38_000} clips={[...CLIPS(5, 7).slice(0, 6), { number: 7, state: "failed" }]} draft={{ state: "kept", name: "雾港灯塔 EP03（2）", exportFolder: "/tmp/out" }} onOpen={noop} onOpenDraft={noop} />
        </Shown>
        <Shown caption="no JianYing, many shots">
          <FinalCard episode={12} title={LONG} clips={CLIPS(20, 24)} draft={{ state: "unavailable", reason: "not-installed", exportFolder: "/tmp/out" }} onOpen={noop} />
        </Shown>
      </Section>

      <Section id="generic" title="Other nodes">
        <Shown caption="text">
          <GenericCard node={{ type: "text", title: "导演笔记", metadata: { content: SCRIPT } }} onOpen={noop} />
        </Shown>
        <Shown caption="text, empty">
          <GenericCard node={{ type: "text", title: "空白笔记" }} onOpen={noop} />
        </Shown>
        <Shown caption="image">
          <GenericCard node={{ type: "image", title: "参考图：港口" }} fileUrl={SCENES.market} onOpen={noop} />
        </Shown>
        <Shown caption="image generating">
          <GenericCard node={{ type: "image", title: "海报草图", metadata: { status: "loading" } }} onOpen={noop} />
        </Shown>
        <Shown caption="image failed">
          <GenericCard node={{ type: "image", title: "海报草图", metadata: { status: "error", errorDetails: "The image model refused the prompt" } }} onOpen={noop} onGenerate={noop} />
        </Shown>
        <Shown caption="video">
          <GenericCard node={{ type: "video", title: "预告片", metadata: { durationMs: 12_000 } }} fileUrl={FILM} onOpen={noop} onPlay={noop} />
        </Shown>
        <Shown caption="file">
          <GenericCard node={{ type: "file", title: "雾港灯塔-原著.pdf" }} onOpen={noop} />
        </Shown>
      </Section>

      <Section id="far" title="Far view">
        <Shown caption="board at 30%">
          <FarView zoom={0.3} />
        </Shown>
        <Shown caption="board at 12%">
          <FarView zoom={0.12} />
        </Shown>
      </Section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
