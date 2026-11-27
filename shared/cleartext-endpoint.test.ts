import { describe, expect, it } from "vitest";
import { isCleartextRemote } from "./cleartext-endpoint";

describe("cleartext endpoint warning", () => {
  it.each([
    "http://192.168.1.9:11434",
    "http://8.8.8.8:8080/v1",
    "http://llm.example.com",
    " http://LLM.example.com/v1 ",
  ])("warns about plain http off this computer: %s", (url) => {
    expect(isCleartextRemote(url)).toBe(true);
  });
  it.each([
    "https://llm.example.com",
    "http://localhost:11434",
    "http://127.0.0.1:11434/v1",
    "http://[::1]:11434/v1",
    "ftp://llm.example.com",
    "llm.example.com",
    "",
    null,
  ])("stays quiet otherwise: %s", (url) => {
    expect(isCleartextRemote(url)).toBe(false);
  });
});
