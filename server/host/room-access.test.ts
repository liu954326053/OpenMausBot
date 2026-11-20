import { describe, expect, it } from "vitest";

import type { BotRecord, Store } from "../store.ts";
import { createRoomAccess, PRIVATE_CHAT_ROOM_WRITE } from "./room-access.ts";

// Only a thread opened as a parallel room job answers to its room; a work
// thread a room conversation opened for anything else does not.
describe("laneRoomThread", () => {
  const tasks: Record<string, { openedBy?: Record<string, unknown> }> = {
    lane: { openedBy: { botId: "lead", name: "Lead", kind: "work", threadId: "room-thread", roomLane: true, at: 1 } },
    work: { openedBy: { botId: "lead", name: "Lead", kind: "work", threadId: "room-thread", at: 1 } },
  };
  const store = {
    taskByThread: (_botId: string, threadId: string) => tasks[threadId],
    groupByThread: (threadId: string) => threadId === "room-thread" ? { id: "room" } : undefined,
  } as unknown as Store;
  const { laneRoomThread } = createRoomAccess({ store });

  it("names the room thread of a parallel room job only", () => {
    expect(laneRoomThread({ botId: "e1", threadId: "lane" })).toBe("room-thread");
    expect(laneRoomThread({ botId: "e1", threadId: "work" })).toBeUndefined();
    expect(laneRoomThread({ botId: "e1", threadId: "lane", groupId: "room" })).toBeUndefined();
  });
});

describe("roomTalks", () => {
  const bots = {
    insider: { id: "insider", name: "Insider", section: "Build" },
    stranger: { id: "stranger", name: "Stranger", section: "Elsewhere" },
  } as unknown as Record<string, BotRecord>;
  const store = {
    bot: (id: string) => bots[id],
    messagesFor: () => [],
  } as unknown as Store;
  const { roomTalks } = createRoomAccess({ store });
  const room = (over: Record<string, unknown> = {}) => ({
    id: "room", threadId: "room-thread", dm: false, memberIds: ["insider"], name: "Room", ...over,
  }) as never;

  it("returns one discriminated problem per rule", () => {
    expect(roomTalks(bots.insider!, room())).toEqual({ ok: true });
    expect(roomTalks(bots.insider!, room({ dm: true, threadId: "dm-thread" }))).toEqual({ ok: false, problem: "dm" });
    expect(roomTalks(bots.stranger!, room({ memberIds: ["insider"] }))).toEqual({ ok: false, problem: "not-member" });
    expect(roomTalks(bots.insider!, room({ memberIds: ["insider", "stranger"] }))).toEqual({ ok: true });
    expect(roomTalks(bots.insider!, room({ setupCompletedAt: null, setupSkippedAt: null })))
      .toEqual({ ok: false, problem: "setup" });
    expect(roomTalks(bots.insider!, room({ setupCompletedAt: 1 }))).toEqual({ ok: true });
  });
});


describe("roomHandoffTarget", () => {
  const bots = {
    chief: { id: "chief", name: "Chief", threadId: "chief-main", section: "Sales OS" },
    member: { id: "member", name: "Member", threadId: "member-main", section: "General" },
    buyer: { id: "buyer", name: "Buyer Research", threadId: "buyer-main", section: "Sales OS" },
    gone: { id: "gone", name: "Gone", threadId: "gone-main", hidden: true },
  } as unknown as Record<string, BotRecord>;
  const rooms: Record<string, Record<string, unknown>> = {
    room: { id: "room", threadId: "room-thread", dm: false, memberIds: ["chief", "member"], name: "Room" },
    fresh: { id: "fresh", threadId: "fresh-thread", dm: false, memberIds: ["chief"], name: "Fresh", setupCompletedAt: null, setupSkippedAt: null },
    dm: { id: "dm", threadId: "dm-thread", dm: true, memberIds: ["chief"], name: "DM" },
  };
  const store = {
    bot: (id: string) => bots[id],
    group: (id: string) => rooms[id],
    groupByThread: (threadId: string) => Object.values(rooms).find(room => room.threadId === threadId),
    groupTaskByThread: (groupId: string, threadId: string) => rooms[groupId]?.threadId === threadId ? { threadId } : undefined,
    taskByThread: (botId: string, threadId: string) => bots[botId]?.threadId === threadId ? { threadId } : undefined,
    messagesFor: () => [],
  } as unknown as Store;
  const { roomHandoffTarget, roomHandoffProblem } = createRoomAccess({ store, privateTo: (threadId) => threadId === "private-thread" ? "ada" : null });
  const chief = { groupId: "room", threadId: "room-thread", botId: "chief" };

  it("sends work addressed into a room to a bot outside it directly, in its own thread", () => {
    const target = roomHandoffTarget({ groupId: "room", threadId: "room-thread", botId: "buyer" }, chief);
    expect(target).toEqual({ botId: "buyer", threadId: "buyer-main" });
    expect(roomHandoffProblem(target, chief)).toBeUndefined();
  });

  it("keeps a member's work in the room, and every other room rule", () => {
    const member = { groupId: "room", threadId: "room-thread", botId: "member" };
    expect(roomHandoffTarget(member, chief)).toBe(member);
    const fromPrivate = { groupId: "room", threadId: "room-thread", botId: "buyer" };
    expect(roomHandoffTarget(fromPrivate, { threadId: "private-thread" })).toBe(fromPrivate);
    expect(roomHandoffProblem(fromPrivate, { groupId: undefined, threadId: "private-thread", botId: "chief" })).toBe(PRIVATE_CHAT_ROOM_WRITE);
    const unfinished = { groupId: "fresh", threadId: "fresh-thread", botId: "buyer" };
    expect(roomHandoffTarget(unfinished, chief)).toBe(unfinished);
    expect(roomHandoffProblem(unfinished, chief)).toBe("Destination room setup is unfinished");
    for (const node of [{ groupId: "dm", threadId: "dm-thread", botId: "buyer" }, { groupId: "room", threadId: "room-thread", botId: "gone" }, { threadId: "buyer-main", botId: "buyer" }]) {
      expect(roomHandoffTarget(node, chief)).toBe(node);
    }
  });

  it("says a bot outside the room isn't a member, and that work sent again goes to it directly", () => {
    expect(roomHandoffProblem({ groupId: "room", threadId: "room-thread", botId: "buyer" }, chief))
      .toBe("The addressed agent isn't a member of this room; work sent to it again goes to it directly, in a thread of its own");
  });
});

describe("a room job in a thread of its own", () => {
  const room = { id: "room", threadId: "room-thread", dm: false, memberIds: ["e1"], name: "Room" };
  const store = {
    bot: (id: string) => ({ id, name: id, threadId: `${id}-main` }),
    group: () => room,
    groupByThread: (threadId: string) => threadId === "room-thread" ? room : undefined,
    taskByThread: (_botId: string, threadId: string) => threadId === "lane"
      ? { openedBy: { botId: "lead", name: "Lead", kind: "work", threadId: "room-thread", roomLane: true, at: 1 } } : undefined,
  } as unknown as Store;
  const { roomHandoffProblem } = createRoomAccess({ store });

  it("stops once its member leaves the room", () => {
    expect(roomHandoffProblem({ botId: "e1", threadId: "lane" })).toBeUndefined();
    room.memberIds = [];
    expect(roomHandoffProblem({ botId: "e1", threadId: "lane" })).toMatch(/^The addressed agent is no longer a member of this room, so its room job stopped/);
  });
});

describe("roomHandoffProblem", () => {
  const bots = {
    coder: { id: "coder", name: "Coder", visibility: { people: ["ada@acme.test"] } },
    tester: { id: "tester", name: "Tester", visibility: { people: ["ada@acme.test"] } },
    outsider: { id: "outsider", name: "Outsider" },
  } as unknown as Record<string, BotRecord>;
  const store = {
    bot: (id: string) => bots[id],
    taskByThread: (botId: string, threadId: string) => threadId.startsWith(botId) ? { threadId } : undefined,
  } as unknown as Store;
  const { roomHandoffProblem } = createRoomAccess({ store });
  const from = { botId: "coder", threadId: "coder-chat" };

  it("lets a bot reach its own thread whatever its audience, and keeps the audience rule for every other bot", () => {
    expect(roomHandoffProblem({ botId: "coder", threadId: "coder-review" }, from)).toBeUndefined();
    expect(roomHandoffProblem({ botId: "tester", threadId: "tester-work" }, from)).toBeUndefined();
    expect(roomHandoffProblem({ botId: "outsider", threadId: "outsider-work" }, from)).toMatch(/./);
  });
});

describe("a room and a team project's wall", () => {
  const bots = {
    main: { id: "main", name: "MagicBot", defaultBot: {}, chiefOfStaff: true, threadId: "main-main" },
    outside: { id: "outside", name: "Otto", threadId: "outside-main" },
    leadA: { id: "leadA", name: "Ava", chiefOfStaff: true, teamProject: { id: "a", role: "lead" }, threadId: "leadA-main" },
    memberA: { id: "memberA", name: "Arlo", teamProject: { id: "a", role: "writer" }, threadId: "memberA-main" },
    leadB: { id: "leadB", name: "Bea", chiefOfStaff: true, teamProject: { id: "b", role: "lead" }, threadId: "leadB-main" },
    "link-0000abcd-far": { id: "link-0000abcd-far", name: "Far", threadId: "far-main" },
  } as unknown as Record<string, BotRecord>;
  const rooms: Record<string, Record<string, unknown>> = {
    roomA: { id: "roomA", threadId: "roomA-thread", dm: false, memberIds: ["leadA", "memberA"], name: "Writers' room" },
    roomB: { id: "roomB", threadId: "roomB-thread", dm: false, memberIds: ["leadB"], name: "Other writers" },
    general: { id: "general", threadId: "general-thread", dm: false, memberIds: ["main", "outside"], name: "General" },
    mixed: { id: "mixed", threadId: "mixed-thread", dm: false, memberIds: ["main", "leadA"], name: "Mixed before the rule" },
    far: { id: "far", threadId: "far-thread", dm: false, memberIds: ["leadA", "link-0000abcd-far"], name: "With the other place" },
    stale: { id: "stale", threadId: "stale-thread", dm: false, memberIds: ["leadA", "memberA", "deleted-bot"], name: "One member gone" },
  };
  const store = {
    bot: (id: string) => bots[id] ?? null,
    group: (id: string) => rooms[id],
    groupByThread: (threadId: string) => Object.values(rooms).find(room => room.threadId === threadId),
    groupTaskByThread: (groupId: string, threadId: string) => rooms[groupId]?.threadId === threadId ? { threadId } : undefined,
    taskByThread: (botId: string, threadId: string) => bots[botId]?.threadId === threadId ? { threadId } : undefined,
    messagesFor: () => [],
  } as unknown as Store;
  const { roomHandoffProblem } = createRoomAccess({ store });
  const own = (botId: string) => ({ botId, threadId: `${botId}-main` });
  const into = (groupId: string, botId: string) => ({ groupId, threadId: `${groupId}-thread`, botId });
  const NO_SUCH_ROOM = "No such room; use list_room_targets.";

  it("lets a project's bots work in their project's own room", () => {
    expect(roomHandoffProblem(into("roomA", "leadA"), own("memberA"))).toBeUndefined();
    expect(roomHandoffProblem(into("roomA", "memberA"), into("roomA", "leadA"))).toBeUndefined();
    expect(roomHandoffProblem(into("general", "outside"), own("main"))).toBeUndefined();
  });

  it("answers the main bot that a project's room does not exist, though it reaches the lead directly", () => {
    expect(roomHandoffProblem(own("leadA"), own("main"))).toBeUndefined();
    expect(roomHandoffProblem(into("roomA", "leadA"), own("main"))).toBe(NO_SUCH_ROOM);
  });

  it("answers a project's bot that a room outside its project does not exist, the main bot's rooms included", () => {
    expect(roomHandoffProblem(own("main"), own("memberA"))).toBeUndefined();
    expect(roomHandoffProblem(into("general", "main"), own("memberA"))).toBe(NO_SUCH_ROOM);
    expect(roomHandoffProblem(into("roomB", "leadB"), own("leadA"))).toBe(NO_SUCH_ROOM);
    expect(roomHandoffProblem(into("roomA", "leadA"), own("outside"))).toBe(NO_SUCH_ROOM);
  });

  it("closes a room that mixes sides to both, and counts a member of the person's other place as outside every project", () => {
    expect(roomHandoffProblem(into("mixed", "leadA"), own("main"))).toBe(NO_SUCH_ROOM);
    expect(roomHandoffProblem(into("mixed", "main"), own("leadA"))).toBe(NO_SUCH_ROOM);
    expect(roomHandoffProblem(into("far", "leadA"), own("memberA"))).toBe(NO_SUCH_ROOM);
  });

  it("does not close a project's room over a member that is gone", () => {
    expect(roomHandoffProblem(into("stale", "leadA"), own("memberA"))).toBeUndefined();
  });

  it("refuses work sent straight to a bot behind the wall as an unknown id, without its name", () => {
    const refused = roomHandoffProblem(own("leadB"), own("memberA"))!;
    expect(refused).toContain('No bot with id "leadB"');
    expect(refused).not.toContain("Bea");
    expect(roomHandoffProblem(own("memberA"), own("main"))).toContain('No bot with id "memberA"');
    expect(roomHandoffProblem(own("leadA"), own("outside"))).toContain('No bot with id "leadA"');
  });
});
