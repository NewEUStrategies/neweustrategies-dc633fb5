import { describe, expect, it, beforeEach } from "vitest";
import { isPreviewContext, readPreviewSnapshot } from "../sessionHeartbeat";

describe("isPreviewContext", () => {
  it("obejmuje localhost i hosty podglądu", () => {
    expect(isPreviewContext({ hostname: "localhost" }, false)).toBe(true);
    expect(isPreviewContext({ hostname: "127.0.0.1" }, false)).toBe(true);
    expect(isPreviewContext({ hostname: "id-preview--x.lovable.app" }, false)).toBe(true);
    expect(isPreviewContext({ hostname: "neweustrategies.lovable.app" }, false)).toBe(true);
  });

  it("pomija produkcyjną domenę poza iframem, obejmuje ją w iframie", () => {
    expect(isPreviewContext({ hostname: "neweuropeanstrategies.com" }, false)).toBe(false);
    expect(isPreviewContext({ hostname: "neweuropeanstrategies.com" }, true)).toBe(true);
  });
});

describe("readPreviewSnapshot", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("zwraca null bez zapisu i przy śmieciach", () => {
    expect(readPreviewSnapshot()).toBeNull();
    sessionStorage.setItem("__lov_preview_snapshot", "{nie-json");
    expect(readPreviewSnapshot()).toBeNull();
  });

  it("odczytuje świeży snapshot i odrzuca przeterminowany", () => {
    const now = 5_000_000;
    sessionStorage.setItem(
      "__lov_preview_snapshot",
      JSON.stringify({ href: "https://x.test/a", scrollY: 420, atMs: now - 1_000 }),
    );
    expect(readPreviewSnapshot(now)).toEqual({
      href: "https://x.test/a",
      scrollY: 420,
      atMs: now - 1_000,
    });
    expect(readPreviewSnapshot(now + 11 * 60_000)).toBeNull();
  });
});
