import { describe, expect, it } from "vitest";
import {
  DEFAULT_TICKER_CONFIG,
  MAX_TICKER_VARIANTS,
  makeDefaultVariant,
  normalizeTickerConfig,
  normalizeTickerSettings,
  resolveActiveTickerConfig,
} from "@/lib/views/tickerVariants";
import { resolveTickerSource } from "@/lib/views/headerTickerQuery";

describe("tickerVariants", () => {
  it("wraps legacy flat config into a single Domyślny variant", () => {
    const s = normalizeTickerSettings({
      enabled: true,
      source: "pinned",
      pinnedPostId: "00000000-0000-0000-0000-000000000001",
    });
    expect(s.variants).toHaveLength(1);
    expect(s.variants[0].name).toBe("Domyślny");
    expect(s.activeVariantId).toBe(s.variants[0].id);
    expect(s.variants[0].config.source).toBe("pinned");
  });

  it("preserves an existing TickerSettings shape and clamps to MAX_TICKER_VARIANTS", () => {
    const raw = {
      activeVariantId: "missing",
      variants: Array.from({ length: MAX_TICKER_VARIANTS + 2 }, (_, i) => ({
        id: `v${i}`,
        name: `V${i}`,
        config: { source: "latest" as const, limit: 5 },
      })),
    };
    const s = normalizeTickerSettings(raw);
    expect(s.variants).toHaveLength(MAX_TICKER_VARIANTS);
    // Falls back to first variant when active id doesn't exist.
    expect(s.activeVariantId).toBe(s.variants[0].id);
  });

  it("normalizeTickerConfig fills every required field with sane defaults", () => {
    const c = normalizeTickerConfig({});
    expect(c.enabled).toBe(true);
    expect(c.iconAnimation).toBe("flicker");
    expect(c.mixedFill).toBe("trending");
    expect(c.colors?.light).toBeDefined();
    expect(c.colors?.dark).toBeDefined();
  });

  it("makeDefaultVariant produces unique ids", () => {
    const a = makeDefaultVariant();
    const b = makeDefaultVariant();
    expect(a.id).not.toBe(b.id);
    expect(a.config.iconAnimation).toBe(DEFAULT_TICKER_CONFIG.iconAnimation);
  });

  it("resolveActiveTickerConfig extracts the active variant's config", () => {
    const s = normalizeTickerSettings({
      activeVariantId: "keep",
      variants: [
        { id: "skip", name: "Skip", config: { source: "trending" } },
        { id: "keep", name: "Keep", config: { source: "mixed", mixedFill: "latest" } },
      ],
    });
    const cfg = resolveActiveTickerConfig(s);
    expect(cfg.source).toBe("mixed");
    expect(cfg.mixedFill).toBe("latest");
  });
});

describe("resolveTickerSource", () => {
  it("routes 'mixed' straight through", () => {
    expect(resolveTickerSource({ source: "mixed" })).toBe("mixed");
  });
  it("falls back from 'selected' to 'latest' when list empty", () => {
    expect(resolveTickerSource({ source: "selected", selectedPostIds: [] })).toBe("latest");
  });
  it("respects pinnedUntil expiry", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(resolveTickerSource({ source: "pinned", pinnedPostId: "x", pinnedUntil: past })).toBe(
      "latest",
    );
  });
});
