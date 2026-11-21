# Chief authority over additional departments

Every bot reaches every other bot, in any department, with nothing to set up:
departments are folders, not walls. The one wall is a team project; see
[Team projects are walls](#team-projects-are-walls). What a department decides is authority. A
Chief's own department is always its own; in its profile, open **Permissions →
Also in charge of**, select named departments and choose **Save departments**
to put it in charge of them too: it supervises their bots, gets their incidents,
retries their threads and proposes setup changes there.
Selection alone changes nothing before Save. Specialists do not inherit their
Chief's authority or permissions. Persisted empty departments are selectable
too, as is General. A new grant must name an existing department exactly.
Renaming or deleting an empty department revokes its old grants; recreating
its name never restores them. A no-op rename preserves them. A Chief in charge
of every department (General and every other one selected) gets each new
department added to its list as it is made; one in charge of only some does
not, and a department unselected later stays unselected. A Chief someone owns
on a Team Cloud never gets one this way.

Run these checks against disposable fixtures only:

```sh
pnpm exec vitest run server/peer-roster.test.ts server/peer-roster-owners.test.ts server/chief-of-staff.test.ts server/runtime-coordinator.test.ts server/bot-overview.test.ts src/components/bot-settings/PermissionsSection.test.ts --maxWorkers=2
pnpm exec vitest run server/room-coordination.e2e.test.ts server/direct-coordination.e2e.test.ts server/cloud-team-open-reach.e2e.test.ts --maxWorkers=2
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/team-access-ui.e2e.test.ts --maxWorkers=1
```

The real settings UI check creates Clive in Office and three separate
departments. It selects Engineering, Research and a persisted empty
department, proves nothing changed before Save, then checks the saved grants
and revokes Engineering. Renaming the empty department updates the open
selector and revokes its old grant; a recreated name appears unselected. The
screenshot and before/after JSON are retained beside the fixture's server log
(`.team-access.png` and `.team-access.json`). The launcher removes only its own
disposable data.

The server checks prove a bot asking a bot in another department directly on a
desktop and on a Team Cloud (from a member's private chat, with the answer
coming back there and the work staying private to that member), a room mixing
departments, no specialist authority
inheritance, demotion revoking a Chief's grants, and a Team Cloud Chief keeping
authority over exactly its person's bots. An active bot cannot give itself new
department authority through an unpaired loopback request, even with a forged
Origin header; a paired owner or packaged desktop is required.

These fixtures use scripted providers, not live model judgment. Nested
coordination is covered in `server/direct-coordination.e2e.test.ts`; a grant
does not lift the job runtime's depth limit (docs/runtime-contract.md §6).

## Team projects are walls

A team project is one short drama: a folder and the team that works in it. A
bot's project is the `teamProject` on its record. Its department alone does not
put it in one: a bot filed in a project's department without the mark is
outside the project, and the project's own bots do not reach it.

- A project's bots are told of, and reach, the bots of their own project and
  the main bot: the person's MagicBot, which is in no project.
- The main bot reaches each project's lead, the Chief of the project's
  department, and none of its other bots. "Also in charge of" gives it no say
  inside a project, whatever is selected there.
- A bot outside every project reaches no project's bot, its lead included.
- Nothing reaches from one project into another.
- A project's lead supervises and sets up its own department only. It cannot
  add a bot to another department or make a new one.
- A room holds the bots of one project, or of none. A room filed in a
  project's department takes that project's bots only. So the main bot is in no
  room with a project's bot, its lead included.
- The person talks to any bot.

A bot behind the wall is answered as a bot that does not exist, in the words a
made-up id gets, whether it was asked for by id, by the start of an id or by
name; so are its threads and the rooms it is in. The one exception is the main
bot asking for authority over a lead, which it can see: it is told that what
is inside a project is set up from inside it. Projects made from one team
share their bots' names: a name resolves inside the asking bot's own
project, and the main bot asking for a name two leads share is given both,
each with its project's department.

Outside the wall on purpose: the person's notifications and daily brief, which
the main bot reads for the person and which carry every bot's entries, a
project's members included; the skills library; the person's "About me"; and,
on a Team Cloud only, Team files. The wall is not a sandbox either: a bot with
full access to the disk can still read another project's folder by path.

```sh
pnpm exec vitest run server/peer-roster-team-projects.test.ts server/team-project-leads.test.ts server/host/room-access.test.ts server/host/personal-reach.test.ts server/host/chief-rooms.test.ts server/host/thread-posts.test.ts server/host/cloud-computer-reset-asks.test.ts server/team-setup-requests.test.ts server/routes/internal-chief-team.test.ts server/routes/internal-mcp.test.ts server/trigger-tools.test.ts server/incidents.test.ts --maxWorkers=2
pnpm exec vitest run server/team-project-wall.e2e.test.ts --maxWorkers=1
pnpm exec vitest run server/team-project-wall-real-projects.e2e.test.ts --maxWorkers=1
```

The server check starts a fixture with the main bot, one bot outside projects
and two projects of two bots each: a Director who leads and a Writer, under the
same two names in both, as two projects made from one team have them.
Making projects is not what it checks, so it stops the server, marks the four
bots in `bots.json`, writes the two projects into `projects.json` and starts
the server again on the same data. Then the person writes to one bot after the
other, and each plays scripted tool calls. What each AI was told when it
started, every call and every answer are kept beside the fixture's server log
(`.team-project-wall.json`). It proves:

- A project's member is told its own lead and the main bot, and its own
  department's brief and team note, and nothing of the other project or of the
  bot outside. `list_bots` agrees. `coordinate_bots` answers the other
  project's two bots by id, and the bot outside by id and by name, word for
  word like a made-up id; `start_thread`, `post_to_thread` and `wait_until`
  answer the other project's member, by its id or its thread's, like a made-up
  id too. Its own lead's name reaches its own lead. It is not told where a bot
  of the person's other place lives, when the person @mentions that bot or by
  `coordinate_bots` or `wait_until`; the bot outside projects is, by all
  three.
- The main bot is told both leads, each with its project's department, and no
  member. A member by id or by name is answered like a made-up id, and the
  name both leads share is answered with the two leads and their projects. For
  a member it is refused a profile change, a team setup change, a retry, the
  triggers, a thread on it and a wait for it. For the lead it is refused a
  profile change, a team setup change, a retry, the triggers and a room with
  it. It is refused a new bot in the project's department, and it has no
  `create_bot`, so it copies no bot. Work it hands to a lead is handed on by that lead to its own
  member, and the result comes back up.
- A bot outside every project is told of no project's bot and reaches none,
  its lead included, and the refusals say nothing of projects.
- The person cannot put two projects' bots, or the main bot and a lead, in one
  room, nor a bot from outside in a room filed in a project's department; nor
  can a room be changed into either. Two projects' bots cannot be in one
  calendar call, when it is made or changed, and a call scheduled before the
  projects were made does not open a mixed room. A bot handing work into the
  other project's room, or posting there, is answered as for a made-up room
  id, and nothing arrives in that room.
- A project's lead reaches its own bots and the main bot, lists and sets up its
  own department alone, and is refused the other project's lead and bots, the
  bot outside, another department and a new one.

The second server check makes the projects the way the person does, through
the real routes: it sets up a department of a Director who leads and a Writer,
sets the folder for projects and makes two projects from that team. What each
AI was told and every answer are kept beside the
fixture's server log (`.two-real-projects.json`). It proves:

- Each project's Director is the Chief of its project's department and the
  project's lead; MagicBot and the team's own Director stay Chiefs.
- A member is told its own lead and the main bot alone. The other project's
  lead and member, the team's own bots and the bot outside projects are
  answered word for word like a made-up id, and the name Director reaches its
  own lead.
- The main bot is told both leads, each as a project's lead, and no member.
  `list_team_setup` shows it nothing of a project, a member's id is answered
  like a made-up id, and a profile change for a lead is refused. Work it hands
  to a lead reaches the member through that lead, and the result comes back.
- A bot the person adds to a project's department, and a bot the project's
  lead makes with `create_bot`, join that project: its lead is told of them,
  and the other project's member finds neither, by id or by name.
- The team the projects were made from and the bot outside projects are told
  of no project's bot and reach none.
- A room of the two leads, of the main bot and a lead, or with a bot from
  outside in a project's department is refused; a room of one project's bots
  is made.

By unit tests only, not by the server check: a Team Cloud member's own
MagicBot (`server/host/personal-reach.test.ts`), incident reports going to the
project's own lead (`server/incidents.test.ts`), the list of bots an MCP
server is given to (`server/routes/internal-mcp.test.ts`), the Chief a room
is offered (`server/host/chief-rooms.test.ts`), a reset of another bot's
cloud computer (`server/host/cloud-computer-reset-asks.test.ts`), and that
making a project's lead demotes no other Chief and that no project's lead is
taken for the main Chief or given the person's day
(`server/team-project-leads.test.ts`). By no test: a project's bots are kept
out of the link between a computer and the person's own server
(`server/host/bot-link-host.ts`, and the two places in `server/index.ts` that
offer the far side's bots to a bot); the fixture here has one place.

Ports are probed, not reserved. When other suites start servers on the same
machine, something else can answer on the port picked for the second start;
the check takes a server for its own only when `GET /api/health` reports the
pid of the process it started, and tries another port otherwise.
