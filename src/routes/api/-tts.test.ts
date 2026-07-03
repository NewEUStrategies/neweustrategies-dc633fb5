import { describe, it, expect } from "vitest";
import { normalizeTtsInput } from "./tts";

describe("normalizeTtsInput", () => {
  it("rejects missing or blank text", () => {
    expect(normalizeTtsInput({})).toEqual({ ok: false, error: "Missing text" });
    expect(normalizeTtsInput({ text: "   " })).toEqual({ ok: false, error: "Missing text" });
  });

  it("trims text and applies voice/model defaults", () => {
    const r = normalizeTtsInput({ text: "  hello  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.safeText).toBe("hello");
      expect(r.voiceId).toBe("JBFqnCBsd6RMkjVDRZzb");
      expect(r.model).toBe("eleven_multilingual_v2");
    }
  });

  it("rejects voiceId outside the [A-Za-z0-9]{8,40} allowlist", () => {
    expect(normalizeTtsInput({ text: "hi", voiceId: "short" })).toEqual({
      ok: false,
      error: "Invalid voiceId",
    });
    expect(normalizeTtsInput({ text: "hi", voiceId: "has space 1234" })).toEqual({
      ok: false,
      error: "Invalid voiceId",
    });
    expect(normalizeTtsInput({ text: "hi", voiceId: "../../secret0000" })).toEqual({
      ok: false,
      error: "Invalid voiceId",
    });
  });

  it("accepts a valid custom voiceId and model", () => {
    const r = normalizeTtsInput({ text: "hi", voiceId: "ABCdef123456", model: "eleven_turbo_v2" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.voiceId).toBe("ABCdef123456");
      expect(r.model).toBe("eleven_turbo_v2");
    }
  });

  it("clamps text to 5000 characters", () => {
    const r = normalizeTtsInput({ text: "a".repeat(6000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.safeText.length).toBe(5000);
  });
});
