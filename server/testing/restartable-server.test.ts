import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { healthAnswerer } from "./restartable-server.ts";

const servers: Server[] = [];
const closed = (server: Server) => new Promise((resolve) => server.close(resolve));
afterEach(async () => { await Promise.all(servers.splice(0).map(closed)); });

async function answering(status: number, body: string): Promise<string> {
  const server = createServer((_request, response) => { response.writeHead(status, { "content-type": "application/json" }).end(body); });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("who answers a restartable server's port", () => {
  it("is the server's own child only when OpenMausBot answers with that child's pid", async () => {
    expect(await healthAnswerer(await answering(200, JSON.stringify({ app: "openmausbot", pid: 4242 })), 4242)).toBe("ours");
  });

  it("is someone else when another OpenMausBot answers, with its own pid or only its name", async () => {
    expect(await healthAnswerer(await answering(200, JSON.stringify({ app: "openmausbot", pid: 4343 })), 4242)).toBe("theirs");
    expect(await healthAnswerer(await answering(200, JSON.stringify({ app: "openmausbot" })), 4242)).toBe("theirs");
  });

  it("is someone else for a child that has no pid", async () => {
    expect(await healthAnswerer(await answering(200, JSON.stringify({ app: "openmausbot" })), undefined)).toBe("theirs");
  });

  it("is someone else when something other than OpenMausBot answers", async () => {
    expect(await healthAnswerer(await answering(404, "<html>Not found</html>"), 4242)).toBe("theirs");
  });

  it("is nobody while nothing listens", async () => {
    const url = await answering(200, "{}");
    await closed(servers.pop()!);
    expect(await healthAnswerer(url, 4242)).toBe("nobody");
  });
});
