# A team's pipeline on the team map

The team map draws a team's pipeline from `GET /api/team-pipelines` and changes it through
`PUT /api/team-pipelines/line`, `POST /api/team-pipelines/rejudge` and `PUT /api/team-pipelines/restore`
(`shared/team-pipeline.ts`).

## Tests

```sh
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run \
  src/lib/team-pipeline.test.ts src/state/team-pipelines.dom.test.ts \
  src/components/team-pipeline src/components/TeamCanvas.pipeline.dom.test.ts
```

They cover the stage columns, several lines into one card, adding and removing a line by pointer and by keyboard, a
refusal in the server's words, the marks of a member being placed or set by hand, judging again with its Undo, and a
card keeping the place the person gave it in its column. Their server is a `fetch` that answers as the contract says.

## Looking at it

`scripts/testing/team-pipeline-preview.tsx` is the real team map over a pipeline server faked in the page, so it needs
no server at all. `scripts/testing/team-pipeline-shots.ts` opens it in a headless Chrome, in Midnight and Daylight, and
writes one picture per state:

```sh
OMB_AGENT_BROWSER_PATH=/path/to/agent-browser \
AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node --experimental-strip-types scripts/testing/team-pipeline-shots.ts /tmp/team-pipeline-shots
```

Expected, per skin: a four-member drama team in one row from the lead to post (`drama`); a team whose two `other`
members hang under the lead while the script's line to the storyboard passes under the character card (`others`); the
menu on a card's dot with a tick beside who already gets its work (`drama-dot-menu`, `drama-keyboard-menu`); a
selected line with its remove button (`drama-line-selected`, `drama-keyboard-line`); a refusal under the card the
line was drawn from (`drama-refused`); a line being dragged, and the same line added with both of its ends marked as
set by hand (`drama-dragging`, `drama-by-hand`); a line removed from the keyboard (`drama-keyboard-removed`); the
team's menu with Judge again, and a team being judged again with its Undo (`drama-team-menu`,
`drama-judging-again`); the smallest window (`others-narrow`, `crowd-en-narrow`); long names, three stages on one
card and right-to-left text (`crowd-en`).
