import { describe, it, expect } from "vitest";
import {
  EMPTY_BODY,
  isGatedMode,
  hasRenderableBody,
  shouldShowPaywall,
  pickBody,
  type BodyParts,
} from "@/lib/access/gating";

const html = (s: string): BodyParts => ({ ...EMPTY_BODY, content_pl: s });
const builder = (n: number): BodyParts => ({
  ...EMPTY_BODY,
  builder_data: { version: 1, sections: Array.from({ length: n }, (_, i) => ({ id: String(i) })) },
});
const blocks = (n: number): BodyParts => ({
  ...EMPTY_BODY,
  blocks_data: { pl: { blocks: Array.from({ length: n }, (_, i) => ({ id: String(i) })) } },
});

describe("isGatedMode", () => {
  it("treats members and paid as gated", () => {
    expect(isGatedMode("members")).toBe(true);
    expect(isGatedMode("paid")).toBe(true);
  });
  it("treats public / nullish as open", () => {
    expect(isGatedMode("public")).toBe(false);
    expect(isGatedMode(null)).toBe(false);
    expect(isGatedMode(undefined)).toBe(false);
  });
});

describe("hasRenderableBody", () => {
  it("is false for an empty body", () => {
    expect(hasRenderableBody(EMPTY_BODY)).toBe(false);
    expect(hasRenderableBody(html("   "))).toBe(false);
  });
  it("detects html, builder sections and blocks in any locale", () => {
    expect(hasRenderableBody(html("<p>hi</p>"))).toBe(true);
    expect(hasRenderableBody({ ...EMPTY_BODY, content_en: "<p>hi</p>" })).toBe(true);
    expect(hasRenderableBody(builder(2))).toBe(true);
    expect(hasRenderableBody(blocks(1))).toBe(true);
  });
  it("ignores empty builder/blocks shells", () => {
    expect(hasRenderableBody(builder(0))).toBe(false);
    expect(hasRenderableBody({ ...EMPTY_BODY, blocks_data: { pl: { blocks: [] } } })).toBe(false);
  });
});

describe("shouldShowPaywall", () => {
  it("never gates public content", () => {
    expect(shouldShowPaywall("public", EMPTY_BODY)).toBe(false);
    expect(shouldShowPaywall("public", html("<p>x</p>"))).toBe(false);
    expect(shouldShowPaywall(null, EMPTY_BODY)).toBe(false);
  });
  it("gates gated modes when no body was delivered (anon SSR / unauthorized)", () => {
    expect(shouldShowPaywall("paid", EMPTY_BODY)).toBe(true);
    expect(shouldShowPaywall("members", EMPTY_BODY)).toBe(true);
  });
  it("reveals once an entitled body is present in any editor", () => {
    expect(shouldShowPaywall("paid", html("<p>secret</p>"))).toBe(false);
    expect(shouldShowPaywall("members", builder(1))).toBe(false);
    expect(shouldShowPaywall("paid", blocks(1))).toBe(false);
  });
});

describe("pickBody", () => {
  it("prefers an unlocked body with content", () => {
    expect(pickBody(EMPTY_BODY, html("<p>unlocked</p>")).content_pl).toBe("<p>unlocked</p>");
  });
  it("falls back to the ssr body when unlock is null/empty", () => {
    expect(pickBody(html("<p>ssr</p>"), null).content_pl).toBe("<p>ssr</p>");
    expect(pickBody(html("<p>ssr</p>"), EMPTY_BODY).content_pl).toBe("<p>ssr</p>");
  });
});
