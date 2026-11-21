import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { healthAnswerer, webhookPortRefusal } from "./restartable-server.ts";

const servers: Server[] = [];
const closed = (server: Server) => new Promise((resolve) => server.close(resolve));
afterEach(async () => { await Promise.all(servers.splice(0).map(closed)); });

async function answeringWith(answer: (request: IncomingMessage) => [number, string]): Promise<string> {
  const server = createServer((request, response) => {
    const [status, body] = answer(request);
    response.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const answering = (status: number, body: string) => answeringWith(() => [status, body]);

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

describe("what a launched server says about the webhook port above its own", () => {
  const receiver = (ingress: Record<string, unknown>) => JSON.stringify({ webhooks: [], attempts: [], ingress: { baseUrl: "http://127.0.0.1:4243", ...ingress } });

  it("is nothing to refuse while the server's own receiver listens there", async () => {
    expect(await webhookPortRefusal(await answering(200, receiver({ available: true })), 4243)).toBeNull();
  });

  it("says the port is taken by another process when the server's receiver found it in use", async () => {
    const url = await answering(200, receiver({ available: false, error: "listen EADDRINUSE: address already in use 127.0.0.1:4243" }));
    expect(await webhookPortRefusal(url, 4243)).toBe("webhook port 4243 is taken by another process: the server's own webhook receiver could not listen there (listen EADDRINUSE: address already in use 127.0.0.1:4243)");
  });

  it("refuses with the server's own reason when its receiver is down for another one", async () => {
    const url = await answering(200, receiver({ available: false, error: "listen EACCES: permission denied 127.0.0.1:4243" }));
    expect(await webhookPortRefusal(url, 4243)).toBe("the server's webhook receiver is not listening on port 4243: listen EACCES: permission denied 127.0.0.1:4243");
  });

  it("refuses when the server will not say", async () => {
    expect(await webhookPortRefusal(await answering(401, JSON.stringify({ error: "Sign in first." })), 4243)).toBe("the server's webhook receiver is not listening on port 4243: GET /api/webhooks answered 401");
  });

  it("asks with the caller's headers, such as a Cloud owner's token", async () => {
    const url = await answeringWith((request) => request.headers.authorization === "Bearer owner-token"
      ? [200, receiver({ available: true })]
      : [401, JSON.stringify({ error: "Sign in first." })]);
    expect(await webhookPortRefusal(url, 4243, { authorization: "Bearer owner-token" })).toBeNull();
  });
});
