import { describe, expect, it } from "vitest";
import {
  buildRedirectIndex,
  isProtectedPath,
  matchRedirect,
  normalizeSourcePath,
  normalizeTargetPath,
  parseRedirectsCsv,
  serializeRedirectsCsv,
  type RedirectRule,
} from "@/lib/seo/redirects";

const rule = (
  partial: Partial<RedirectRule> & Pick<RedirectRule, "source_path" | "target_path">,
): RedirectRule => ({
  id: partial.source_path,
  status_code: 301,
  ...partial,
});

describe("normalizeSourcePath", () => {
  it("normalizes case, trailing slash and keeps the query", () => {
    expect(normalizeSourcePath("/Stary-Wpis/")).toBe("/stary-wpis");
    expect(normalizeSourcePath("stary-wpis")).toBe("/stary-wpis");
    expect(normalizeSourcePath("/?p=123")).toBe("/?p=123");
    expect(normalizeSourcePath("https://old.example.com/a/b/?x=1#frag")).toBe("/a/b?x=1");
  });
  it("keeps the root and collapses duplicate slashes", () => {
    expect(normalizeSourcePath("/")).toBe("/");
    expect(normalizeSourcePath("//a///b/")).toBe("/a/b");
  });
  it("accepts wildcard suffix and rejects inner stars", () => {
    expect(normalizeSourcePath("/old-section/*")).toBe("/old-section/*");
    expect(normalizeSourcePath("/bad*path")).toBeNull();
  });
  it("rejects empty input", () => {
    expect(normalizeSourcePath("   ")).toBeNull();
  });
});

describe("normalizeTargetPath", () => {
  it("rejects absolute URLs without an allowlist (open-redirect guard)", () => {
    expect(normalizeTargetPath("https://x.example/a")).toBeNull();
    expect(normalizeTargetPath("https://evil.example/phish", [])).toBeNull();
    expect(normalizeTargetPath("javascript:alert(1)")).toBeNull();
    expect(normalizeTargetPath("javascript:alert(1)", ["x.example"])).toBeNull();
  });
  it("accepts absolute https URLs only for allowlisted hosts (www-aliased)", () => {
    const allowed = ["neweuropeanstrategies.com"];
    expect(normalizeTargetPath("https://neweuropeanstrategies.com/a", allowed)).toBe(
      "https://neweuropeanstrategies.com/a",
    );
    expect(normalizeTargetPath("https://www.neweuropeanstrategies.com/a", allowed)).toBe(
      "https://www.neweuropeanstrategies.com/a",
    );
    expect(normalizeTargetPath("https://evil.example/a", allowed)).toBeNull();
    // http downgrade is never a valid redirect target.
    expect(normalizeTargetPath("http://neweuropeanstrategies.com/a", allowed)).toBeNull();
  });
  it("normalizes relative targets to absolute paths", () => {
    expect(normalizeTargetPath("nowa-sekcja/wpis/")).toBe("/nowa-sekcja/wpis");
    expect(normalizeTargetPath("/a?keep=1")).toBe("/a?keep=1");
  });
});

describe("matchRedirect", () => {
  const index = buildRedirectIndex([
    rule({ source_path: "/stary", target_path: "/nowy" }),
    rule({ source_path: "/?p=123", target_path: "/blog/wpis" }),
    rule({ source_path: "/a", target_path: "/b" }),
    rule({ source_path: "/b", target_path: "/c" }),
    rule({ source_path: "/loop1", target_path: "/loop2" }),
    rule({ source_path: "/loop2", target_path: "/loop1" }),
    rule({ source_path: "/gone", target_path: "/", status_code: 410 }),
    rule({ source_path: "/old-section/*", target_path: "/new-section/*" }),
    rule({ source_path: "/old-flat/*", target_path: "/flat" }),
    rule({ source_path: "/self", target_path: "/self?x=1" }),
  ]);

  it("matches exact paths case- and slash-insensitively", () => {
    expect(matchRedirect(index, "/Stary/")?.target).toBe("/nowy");
  });
  it("matches WP shortlinks by path+query and consumes the query", () => {
    expect(matchRedirect(index, "/", "?p=123")?.target).toBe("/blog/wpis");
  });
  it("preserves an unconsumed query string", () => {
    expect(matchRedirect(index, "/stary", "?utm=x")?.target).toBe("/nowy?utm=x");
  });
  it("follows chains to the final hop", () => {
    expect(matchRedirect(index, "/a")?.target).toBe("/c");
  });
  it("refuses to serve redirect loops", () => {
    // /loop1 -> /loop2 -> /loop1: chain resolution re-enters the start, so the
    // safe behavior is NO redirect at all (a single hop would ping-pong the
    // browser forever).
    expect(matchRedirect(index, "/loop1")).toBeNull();
  });
  it("returns gone for 410 rules", () => {
    const m = matchRedirect(index, "/gone");
    expect(m?.gone).toBe(true);
    expect(m?.statusCode).toBe(410);
  });
  it("maps wildcard remainders", () => {
    expect(matchRedirect(index, "/old-section/a/b")?.target).toBe("/new-section/a/b");
    expect(matchRedirect(index, "/old-section")?.target).toBe("/new-section");
    expect(matchRedirect(index, "/old-flat/anything")?.target).toBe("/flat");
  });
  it("never matches protected system paths", () => {
    const guarded = buildRedirectIndex([rule({ source_path: "/admin/x", target_path: "/y" })]);
    expect(matchRedirect(guarded, "/admin/x")).toBeNull();
  });
  it("drops a self-redirect after query append", () => {
    expect(matchRedirect(index, "/self")).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(matchRedirect(index, "/nieistnieje")).toBeNull();
  });
});

describe("isProtectedPath", () => {
  it("protects admin/api/internal prefixes", () => {
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/api/x")).toBe(true);
    expect(isProtectedPath("/_internal")).toBe(false);
    expect(isProtectedPath("/_/x")).toBe(true);
    expect(isProtectedPath("/blog")).toBe(false);
  });
});

describe("CSV round-trip", () => {
  it("parses source,target,status,note with a header", () => {
    const csv = [
      "source,target,status,note",
      "/old-a,/new-a,301,po migracji",
      '/old-b,"/new,b",302,',
      "/gone-x,,410,",
      "bad path with *star*,/x,301,",
      "/old-a,/new-a2,301,duplicate wins",
    ].join("\n");
    const { rows, issues } = parseRedirectsCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.source_path === "/old-a")?.target_path).toBe("/new-a2");
    expect(rows.find((r) => r.source_path === "/old-b")?.target_path).toBe("/new,b");
    expect(rows.find((r) => r.source_path === "/gone-x")?.status_code).toBe(410);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe("invalid_source");
  });
  it("serializes back with quoting", () => {
    const out = serializeRedirectsCsv([
      { source_path: "/a", target_path: "/b,c", status_code: 301, note: 'ma "cudzysłów"' },
    ]);
    expect(out).toContain('/a,"/b,c",301,"ma ""cudzysłów"""');
    const back = parseRedirectsCsv(out);
    expect(back.rows).toHaveLength(1);
    expect(back.rows[0]?.note).toBe('ma "cudzysłów"');
  });
});
