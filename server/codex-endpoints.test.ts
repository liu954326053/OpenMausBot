import { describe, expect, it } from "vitest";
import { codexEndpointSchema, newCodexEndpoint, updateCodexEndpoint, withCodexEndpointInfo } from "./codex-endpoints.ts";

const fields = { displayName: "Gateway", baseUrl: "https://gateway.example/v1", token: "fixture-secret", model: "custom-model" };

describe("Codex direct API endpoints", () => {
  it("creates isolated instances without changing existing accounts or returning the key", () => {
    const original = { driver: "codex", config: { cli: "/fixture/codex" } };
    const { instanceId, instances } = newCodexEndpoint({ instances: { codex: original } } as never, fields);
    expect(instances.codex).toEqual(original);
    expect(instances[instanceId]).toMatchObject({ driver: "codex", access: "custom", config: { cli: "/fixture/codex", endpoint: { url: fields.baseUrl, models: ["custom-model"] } }, environment: { OPENMAUSBOT_CODEX_API_KEY: "fixture-secret" } });
    expect(instances[instanceId].environment?.CODEX_HOME).toContain(instanceId);
    const info = withCodexEndpointInfo([{ instanceId }], instances);
    expect(info).toEqual([{ instanceId, url: fields.baseUrl, codexEndpoint: { baseUrl: fields.baseUrl, models: ["custom-model"], tokenSaved: true } }]);
    expect(JSON.stringify(info)).not.toContain("fixture-secret");
  });

  it("requires a new key when changing hosts and preserves it on a model edit", () => {
    const { instanceId, instances } = newCodexEndpoint({ instances: {} } as never, fields);
    expect(() => updateCodexEndpoint({ instances } as never, instanceId, { baseUrl: "https://other.example/v1" })).toThrow(/token again/);
    const updated = updateCodexEndpoint({ instances } as never, instanceId, { model: "another-model" }).instances[instanceId];
    expect(updated.environment?.OPENMAUSBOT_CODEX_API_KEY).toBe("fixture-secret");
    expect(updated.config).toMatchObject({ endpoint: { models: ["another-model"] } });
    expect(() => updateCodexEndpoint({ instances: { codex: { driver: "codex" } } } as never, "codex", { model: "m" })).toThrow();
  });

  it.each(["https://gateway.example/v1", "http://gateway.example/v1", "http://192.168.1.9:11434", "http://8.8.8.8:8080", "http://llm.example.com"])("accepts an http or https URL (%s)", baseUrl => {
    expect(codexEndpointSchema.safeParse({ ...fields, baseUrl }).success).toBe(true);
  });
  it.each(["ftp://gateway.example/v1", "file:///tmp/socket", "javascript:alert(1)", "https://user:password@gateway.example/v1", "https://gateway.example/v1?key=secret"])("rejects unsafe URLs (%s)", baseUrl => {
    expect(codexEndpointSchema.safeParse({ ...fields, baseUrl }).success).toBe(false);
  });
});
