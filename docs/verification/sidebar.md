# Sidebar confirmations

Launch `node --experimental-strip-types scripts/verify-sidebar.ts`. It creates
an isolated fake-engine server and two disposable bots, then prints a preview
URL. Open that URL, never the user's live app. Ctrl-C closes both servers and
removes only the fixture data.

The preview mounts the actual Sidebar and StoreProvider. The sidebar lists only
the main bot and the projects, and its search finds projects, so Atlas has no
row there; the main bot's menu offers Hide from sidebar and Make this a regular
bot rather than Archive and Delete. In the app the same menu opens from a bot's
card on the team map (its ⋯, a right-click, the ContextMenu key or Shift+F10).
This preview has no team map, so the steps below have no entry point here and
only the unit tests named after them run; the automations journey deletes a bot
from its card.
Verify:

1. Click Archive Sidebar Atlas: Cancel receives focus by default.
2. Shift-Tab wraps to Archive; Tab wraps back to Cancel.
3. Escape closes the dialog, leaves `Drawer: open`, and restores focus to the
   Archive trigger. No bot is archived.
4. Right-click Sidebar Atlas and choose Delete. Cancel leaves the bot intact
   and returns focus to the sidebar if the menu trigger has disappeared.
5. Repeat Delete and confirm. Only the disposable Atlas bot disappears; the
   remaining bots are unchanged and keyboard focus remains in the sidebar.

Verified on 2026-09-05 against the isolated renderer. Static regression coverage
in `src/components/SidebarBotListItem.test.ts` checks dialog semantics/copy,
chief labels, role badges, and working/waiting indicators. The interaction checks
above are manual browser verification, not assertions made by those unit tests.
This fixture covers the sidebar confirmation and bot-row result only; it does
not exercise Settings > Computers deletion or provider completion polling.
Those paths are covered by the computer-section and server Boat inventory tests.

## Projects and the team map

The sidebar lists, top to bottom, the main bot, Inbox, the projects and New
project, then the footer tools. The sidebar's search finds projects only. Bots
and group chats are reached through the team map and the command palette (⌘K).

In the UI fixture (`node --experimental-strip-types scripts/control-omb.ts ui launch`),
set a projects folder under `/tmp` and make two projects from a department with
a Chief through `/api/team-projects`, then check:

1. Simple, Advanced, the icons rail and the phone drawer keep that order, with
   two projects and with none.
2. A click on a project's row opens its group chat, else its lead's
   conversation, else its canvas, and shows under the row the group chat and
   then the bots of the whole drama, the lead first, each with its role after
   its name. A click on the row of the project on screen folds it again. The
   row's mark stays on, folded or not, and counts all the project's bots and
   group chats.
3. Under the whole drama's bots, one Episodes row, folded at first, unfolds
   into a row per episode from EP01 in order, each folded at first. An
   episode's row unfolds into the bots the production made for that episode,
   the storyboard bot then the post bot, each with its role after its name, or
   Storyboard or Post when it has none. A folded row is marked by what goes on
   among the bots under it. A drama with no such bots has no Episodes row.
4. The project's group chat lists only the bots of the whole drama as its
   members, and its Manage members does not offer the bots made for one
   episode.
5. The search, named Search projects, keeps the projects whose name holds what
   is typed, in any case, each still one row with nothing under it; the main
   bot and Inbox stay. A bot's or group chat's name or a message's words find
   no project, and one muted line says so. Clearing the search gives the plain
   list back.
6. The + menu offers exactly New project, New bot and Add department. A bot or
   department made there, or a bot made from the team map's Add menu, opens the
   team map and is brought into view.
7. The team map leaves out the projects' teams, says when a department has no
   Chief, puts a dot on a card with unread output and on the footer's Team map
   entry, and does not take the main bot into a department.
8. A project copy's chat locks its model picker and says why.
9. While a project's canvas is open, its row is the selected one, and so it is
   while one of its conversations is open and the project is folded, unless
   that conversation is a copy's that is pinned and has a row of its own.
   Unfolded, the row listing that conversation is the selected one or, while
   it is folded away, the nearest folded row above it: its episode's or
   Episodes.
10. Archiving a project from its row's menu offers Undo in the bottom-left
    corner, clear of the composer.
11. Renaming a project's folder away shows Project folder not found under its
    row and on its open canvas within a few seconds, with no reload, and
    renaming it back takes both away.
12. In Simple mode, Settings shows Data with the projects folder and the
    archived projects, and restoring one there leaves the app in Simple mode.
13. ⌘1 opens the main bot's chat, and ⌘2 to ⌘9 open the first eight projects
    as a click on their rows does, in the sidebar's order; while a search is
    on, in the order of the projects it leaves.

A drama has bots made for one episode only once its production has reached
that episode. To check steps 3 and 9 without a production run,
`node --experimental-strip-types scripts/testing/sidebar-episodes-shots.ts OUT_DIR`,
with the browser variables `ui launch` needs, mounts the real sidebar over
dramas of 60 episodes with no server behind it and photographs each step in
both reference skins, at 1440×900 and in a small window.

`src/lib/sidebar-shortcut-order.test.ts`,
`src/components/Sidebar.projects.test.ts`, `src/lib/sidebar-projects.test.ts`,
`src/components/Sidebar.search.dom.test.ts`,
`src/components/team-projects/SidebarTeamProjects.dom.test.ts`,
`src/components/team-projects/SidebarProjectEpisodes.dom.test.ts`,
`src/lib/team-projects.test.ts`, `src/components/CommandPalette.dom.test.ts`,
`src/components/project-view/ProjectChat.dom.test.ts`,
`src/components/ManageMembersPanel.dom.test.ts`,
`src/state/team-projects.test.ts`, `server/team-projects/folder-watch.test.ts`,
`server/team-project-folder-live.e2e.test.ts`,
`src/components/settings/SettingsWindow.test.ts`,
`src/components/project-view/ProjectView.dom.test.ts`,
`src/state/project-view.dom.test.ts`, `src/components/TeamMapPage.manage.test.ts`,
`src/lib/team-map-scope.test.ts` and
`src/components/team-projects/ConversationModelPicker.test.ts` cover these
rules; the browser check above confirms them in the real renderer.

## Mark all of a bot's conversations as read

Run `node --experimental-strip-types scripts/verify-sidebar.ts --unread`.
This opt-in fixture seeds Sidebar Atlas with twelve unread webhook-like
conversations across a folder and unfiled history, plus a running fake-provider
turn and a sibling report queued behind its capacity limit. The data directory contains `bulk-read-before.json`.
The action is in a bot's menu, which this preview opens only from a sidebar row,
and Atlas has no row (see above), so step 1 has no entry point here; the tests
named after the steps still run.
Open only the printed `previewUrl`:

1. Open **Actions for Sidebar Atlas → Mark all conversations as read**.
   While requests are pending the action shows progress and cannot be repeated.
2. All existing unread conversations for Atlas become read. Its working and
   queued indicators remain. No conversation is selected, deleted or archived.
3. Reload and inspect the same fixture's `/api/bots` response: unread flags
   remain cleared, transcripts and the queued report remain intact, and
   the fake turn is still running. Other bots retain their state.
4. With no unread conversation, the menu action is disabled. In the real
   app it also remains available with **Show threads** off; thread-pinned
   remote clients do not receive an action that targets their siblings.

`src/lib/bot-read.test.ts` covers legacy state, all folders/unfiled/archived
threads, work and approval preservation, ordered requests for 250 threads,
partial failure/retry and new-thread arrivals. `src/components/SidebarBotRead.test.ts` mounts
the actual menu to check progress, duplicate-click protection, error recovery,
Portuguese copy, hidden thread trees and a menu reopened during a read.
Folder reads use the same request helper and retain their existing tests.

Verified on 2026-10-09 in the isolated renderer: 14 unread threads became
read; all 15 conversations, transcripts, settings and the other bots were
unchanged. One fake-provider turn kept running and one sibling message stayed
queued. The cleared flags persisted after reload, and the empty action was
disabled. Progress was visible during the requests. Native desktop clients
were not exercised by this browser check.

## Department deletion

Departments are made from the sidebar's New menu and managed on the team map.
Run `OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/team-lifecycle-ui.e2e.test.ts --maxWorkers=1`.
The test launches its own isolated server and real renderer; never point it at
the user's live workspace. It makes a department from the New menu, sees the
team map show it, and deletes departments from their ⋯ menu on the map:

- Cancel gets initial focus; Tab and Shift-Tab wrap within the confirmation.
- Escape and Cancel preserve the department and its shared instructions, and
  return focus to the department's ⋯ button.
- Confirming deletion removes an empty department and its shared instructions.
- Populated, pinned-only and archived-only departments can be deleted; their bots
  move to General with their conversations, pinned state and archived state intact.
- Deleting a group-only department keeps the group chat and its conversation in
  General. The confirmation explains that members and conversations are retained.
- While the deletion runs the confirmation is busy and a second press sends
  nothing; a failed deletion keeps it open to try again.

The fixture reports its log path and keeps a snapshot and screenshot on failure.
`src/components/TeamMapDepartment.test.ts` checks the busy and retry behaviour
on its own. Server safeguards still reject deletion during active work, with an
assigned team computer, or when moving the Chief would conflict with General's
Chief; see [Teams](teams.md) for those lifecycle checks.

## Group chats on the team map

The group chats and bot chats outside projects are listed under the team map's
Group chats button. Each has a menu, opened from its ⋯ button (shown on hover
and keyboard focus, always on touch), a right-click, or the ContextMenu key or
Shift+F10 on the row: Rename, Set description (group chats only), Copy
conversation ID and Delete. Rename and the description are edited in the menu;
Enter saves, Escape leaves the name as it was. A remote client only copies the
ID. In a narrow window the list moves sideways to stay on screen, also when
the window narrows while it is open. The same `team-lifecycle-ui` run deletes a
group chat from that list:

- Shift+F10 on the row, its ⋯ button and a right-click open the same menu, with
  focus on its first item.
- Delete asks first, naming the group chat, with Cancel focused. Escape and
  Cancel keep the group chat, leave the list open and give focus back to the row
  or button that opened the menu.
- The delete button deletes the group chat and keeps its bots.

`src/components/TeamMapRooms.dom.test.ts` covers the button, right-click,
keyboard, arrow keys, rename, description, copy, the confirmation and the list
in a narrow window;
`src/components/TeamMapRooms.place.dom.test.ts` where the list and a group
chat's menu open, 8 px inside the window;
`src/components/room-delete-copy.test.ts` the confirmation's words and
`src/state/delete-group.test.ts` the request and a refusal from the server.

## Activity, quieter rows, and notification preference

Use the full-app [threads fixture](threads.md) for channel activity and snooze
interactions. Compact/quiet rows must retain live status and
keyboard-accessible owner-row New thread/New folder controls.

In Settings → Appearance, **Notification sounds** controls the operating
system alert sound on this computer only; it does not disable notification
banners or the bot's own notification setting. `src/lib/notification-preferences.test.ts`
and `src/lib/notify.test.ts` cover persisted preferences, blocked storage, cross-window
reads after Settings unmounts, and the silent flag sent to the desktop bridge.
Actual operating-system sound delivery requires a native Electron smoke test;
the isolated browser cannot prove it.
