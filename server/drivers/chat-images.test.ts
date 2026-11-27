import { describe, expect, it } from "vitest";
import { assertImageTransport, CHAT_IMAGE_BUDGET, chatImageBudget, chatImage } from "./chat-images.ts";

describe("chat image transport and retained budget", () => {
  it("rejects encoded text and mismatched MIME claims while preserving a PNG", () => {
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBv0AAAAASUVORK5CYII=";
    expect(chatImage({ mimeType: "image/png", data }).image_url.url).toBe(`data:image/png;base64,${data}`);
    expect(() => chatImage({ mimeType: "image/jpeg", data })).toThrow("MIME");
    expect(() => chatImage({ mimeType: "image/png", data: Buffer.from("not an image").toString("base64") })).toThrow("MIME");
  });
  it("counts input and successive screenshot batches against one budget", () => {
    const retain = chatImageBudget();
    const part = { type: "image_url" as const, image_url: { url: "x".repeat(CHAT_IMAGE_BUDGET / 2) } };
    retain([part]);
    retain("ordinary text");
    retain([part]);
    expect(() => retain([{ type: "image_url", image_url: { url: "x" } }])).toThrow("cannot be retained");
    expect(() => chatImageBudget()([part])).not.toThrow();
  });
  it.each([
    "https://api.example.com/v1",
    "http://localhost:8000/v1",
    "http://127.0.0.1:8000/v1",
    "http://[::1]:8000/v1",
    "http://192.168.1.9:11434",
    "http://8.8.8.8:8080",
    "http://llm.example.com",
  ])("allows http and https transport: %s", url => {
    expect(() => assertImageTransport(url)).not.toThrow();
  });
  it.each(["ftp://localhost/v1", "file:///etc/passwd", "javascript:alert(1)", "ws://127.0.0.1:8000/v1"])("refuses an unsupported scheme: %s", url => {
    expect(() => assertImageTransport(url)).toThrow("http or https");
  });
});
