# The production board

A project's canvas is its production board: the project's bots and what each made, in five stages from left to right
(Brief, Episodes, Characters · scenes, Storyboards · videos, Post), and the lines of work between them. Check it only
against the isolated fixtures below: a server whose home is a temporary folder with the scripted fake engine and
generation's test MCP server, or a sample drama in the page with no server at all. Never the owner's app, data folder
or JianYing's own folder.

## What it must do

1. It opens on the brief and the writer, or with the member chosen in the sidebar in the middle, and brings that member
   to the middle again when the choice changes. The stage bar says how far each stage got: done, at work, failed or
   waiting. A click on a stage, or its number key 1 to 5, takes the board there; 0 fits the whole board.
2. It draws only the cards near the screen. Episodes that wait are folded into one stack, whose menu unfolds one and
   folds it back.
3. Each line is drawn in the state of the work it carries, done, at work or waiting, with its label. Reference lines
   show only while the toolbar's button asks for them.
4. Zoomed far out, every card is still drawn as itself, scaled down, and the bots wear a pin; the lines keep their
   labels only while the view is not the whole board.
5. A card the person drags, by its name or its buttons too, goes where it was let go and is still there after a reload.
   A press that hardly moves is a click, a press on a player, a field or a link keeps its own job, and a drag anywhere
   else pans. The arrow keys pan; + and - zoom.
6. A click on a card opens what it shows in the layer over the board: a bot's chat from its card, an asset's details
   from the others. Escape closes it. The board tells the layer where each card is on the screen and when the board
   moves, and unfolds an episode the layer asks for.
7. Retry sends a failed episode back to wait its turn: it opens as soon as the episode ahead of it is done, and the
   production ends by itself. Generate again adds a take, Use this take chooses the one the episode uses, and a
   refusal stays until it is dismissed. An archived project's cards offer no action.
8. Before the lead has written anything the board shows only the lead and how to begin.
9. The minimap starts folded on a board narrower than 720 px, and open on a wider one. It
   follows the board's width until the person uses its button; from then on their choice holds while the board is
   open. On a narrow board the minimap is smaller, and the toolbar gives it room.
10. In the app, the sidebar's project row opens the project's group chat under the project's top bar, and its switch
    opens the board and goes back. A bot who joins the project is drawn at once, clear of the others. The project's
    settings cover the whole board, and a terminal's sign-in card stays above them.

## Tests

```sh
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run \
  src/components/production-board src/lib/production-board src/components/project-canvas \
  server/production/engine.test.ts
```

`src/components/production-board/ProductionBoard.dom.test.ts` holds the rules above on the sample drama, each kind of
card has its own test beside it under `cards`, and `server/production/engine.test.ts` holds the order a production
runs in, a retried episode included.

Two server suites run a production from end to end:

```sh
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run \
  server/production.e2e.test.ts server/production-legacy-lines.e2e.test.ts
```

In `server/production.e2e.test.ts` the lead plans a drama once, and the script, the characters and scenes, and each
episode's storyboard, videos and post follow by themselves, an episode at a time as the project allows.
`server/production-legacy-lines.e2e.test.ts` does the same for a team whose data folder still holds the lines the team
map drew in `team-flows.json`, which nothing reads: the project runs from its lead's plan to every episode's film, and
the project's lead reaches every bot of the project. A server the desktop app did not start writes no JianYing draft.

## In a real browser

Only one UI fixture may be up at a time on a computer, across worktrees. Take `/tmp/omb-ui-fixture.lock` first: make
the folder, and wait while it is there; write your name and the pid of the shell that runs the suite on the first
line of its `owner` file; remove the folder as soon as the run ends.

```sh
mkdir /tmp/omb-ui-fixture.lock && echo "$USER $$" > /tmp/omb-ui-fixture.lock/owner
OMB_UI_E2E=1 OMB_UI_EVIDENCE_DIR=/tmp/production-board-ui \
OMB_AGENT_BROWSER_PATH=/path/to/agent-browser \
AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run scripts/testing/project-canvas-ui.e2e.test.ts
rm -rf /tmp/omb-ui-fixture.lock
```

`scripts/testing/project-canvas-ui.e2e.test.ts` first runs a scripted drama of three episodes on a disposable server,
through `scripts/testing/project-canvas-server-preview.tsx`: EP01 made and cut, EP02's storyboard failing and EP03's
held at work. Then it opens the same project in the app itself, through `scripts/testing/threads-preview.tsx`, at
1440×900 and at the app's smallest window, 840×620 with the sidebar open. Last it opens the preview page's sixty
episodes. It writes its screenshots, `evidence.json` and `sixty-episodes.json` into `OMB_UI_EVIDENCE_DIR`.

`scripts/testing/project-canvas-preview.tsx` is the board on the in-memory backend with the sample drama of
`src/testing/production-board-sample.ts`, part-way through its production, so it needs no server and no files.
`?episodes=` sets how long the drama is (60 unless given), `?empty=1` shows it before the lead's plan, `?sample=basic`
is a project made before productions, `?skin=` and `?lang=` choose the skin and the language, and `?bot=<id>` opens
the board on that bot. The suite serves it at `/__production-board.html`, and `window.boardOpenedMs` is how long the
board took from being mounted to its first painted cards. Every kind of card is checked on that same page, moved to
the middle one after another.

Verified on 2026-11-24: the UI suite passed in both skins, and at the smallest window the bars overlapped nothing and
stayed inside the board.

## Numbers to beat

The suite's sixty episodes, in Chrome at 1440×900 on 2026-11-24, over two runs:

- Opening: 73–77 ms the first time the page opens the board, 30–34 ms the next two times. It draws 7 cards at open
  and 50 once the whole board is fitted, with 482 elements in the board then.
- Zooming with the wheel: frame P95 16.8 ms, one frame over 33 ms.
- Panning: frame P95 16.7–16.8 ms, none over 33 ms.

The desktop bench opens the same kind of board on a real server, in a big seeded workspace. It needs the same lock,
and Node's heap raised to 8 GB:

```sh
node --max-old-space-size=8192 --experimental-strip-types scripts/bench-desktop.ts --only big --drama 60 --out /tmp/bench-drama.json
```

It seeds a drama of 60 episodes into the sidebar, opens its chat, then its board, and zooms the board out and in.
Compare `big.dramaBoard.ms` with the opening times above, and `big.dramaBoardZoom.frameMsP95` and `framesOver33ms`
with the zoom's. It does not pan.

## What to look at

Look at each picture in both skins, Daylight and Midnight:

- The stage bar's numbered chips in their states' colours, green for done, amber at work, red failed and grey
  waiting, and the same states on the cards and their lines. Every word on the cards and the lines' labels is readable.
- `03-` to `05-`, at 1440×900 and at a small 760×560: nothing clipped and nothing overlapping, the minimap clear of
  the toolbar and the side panel.
- `11-far-out-labels-only.png` and `31-sixty-episodes-far-`: labels only, each readable.
- `26-smallest-window-`: the app's smallest window with the sidebar open. The board is 560 px wide, the minimap is
  folded and the toolbar's corner takes about 3% of the board. `27-smallest-window-minimap-opened-`: the minimap its
  button opened, still clear of the bars, the corner now about 13%. `evidence.json` keeps these measurements under
  `smallestWindow`.
- At the smallest window, in English and Chinese, the stage bar keeps its five numbered stages inside the board
  and in reach: the whole bar when it fits, else the compact one, which names only the stage in view and never
  scrolls sideways.

## Out of scope

- JianYing. The final card's draft button only brings JianYing to the front; whether JianYing then shows the draft is
  not checked. No test launches or quits JianYing or reads its own folder, and tests write drafts to a temporary
  folder.
- The layer drawn over the board, its side panel, a bot's chat window and an asset's details, has its own tests. Here
  only the board's side of it is held: what the board hands the layer, and that a click opens it.
- Real image and video providers, a packaged desktop build, and the owner's own productions.
