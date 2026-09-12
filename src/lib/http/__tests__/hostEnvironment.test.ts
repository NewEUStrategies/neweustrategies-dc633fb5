import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("normalizes configured host suffixes without accepting lookalike domains", async () => {
  vi.stubEnv("PREVIEW_HOST_SUFFIXES", "preview.example, .STAGE.example, ,");
  vi.stubEnv("EDITOR_HOST_SUFFIXES", "editor.example");
  vi.stubEnv("LEGACY_HOST_SUFFIXES", "old.example, .legacy.example");
  vi.resetModules();
  const host = await import("../host");
  expect(host.isPreviewHost("APP.PREVIEW.EXAMPLE:443")).toBe(true);
  expect(host.isPreviewHost("app.stage.example")).toBe(true);
  expect(host.isPreviewHost("fakepreview.example")).toBe(false);
  expect(host.isEditorOrLocalHost("build.editor.example")).toBe(true);
  expect(host.isNonCanonicalPublicHost("app.old.example")).toBe(true);
  expect(host.isNonCanonicalPublicHost("app.legacy.example")).toBe(true);
  expect(host.isNonCanonicalPublicHost("app.current.example")).toBe(false);
  expect(host.publicFacingOrigin("https://app.preview.example")).toBe(host.CANONICAL_SITE_ORIGIN);
  expect(host.publicFacingOrigin("app.old.example")).toBe(host.CANONICAL_SITE_ORIGIN);
  expect(host.publicFacingOrigin("customer.example")).toBe("https://customer.example");
  expect(host.toCanonicalPublicUrl("https://app.old.example/story?q=1#section")).toBe(
    `${host.CANONICAL_SITE_ORIGIN}/story?q=1#section`,
  );
  expect(host.toCanonicalPublicUrl("not a URL")).toBe("not a URL");
  expect(host.toCanonicalPublicUrl("https://customer.example/story")).toBe(
    "https://customer.example/story",
  );
  expect(host.publicFacingOrigin(undefined)).toBe(host.CANONICAL_SITE_ORIGIN);
  expect(host.publicFacingOrigin("neweuropeanstrategies.com")).toBe(host.CANONICAL_SITE_ORIGIN);
  expect(host.isNonPublicHost(undefined)).toBe(false);
  expect(host.isCanonicalSiteHost(undefined)).toBe(false);
  expect(host.isCanonicalSiteHost("WWW.NEWEUROPEANSTRATEGIES.COM:443")).toBe(true);
  expect(host.isCanonicalSiteHost("customer.example")).toBe(false);
  expect(host.isEditorOrLocalHost(undefined)).toBe(false);
  expect(host.isNonCanonicalPublicHost(undefined)).toBe(false);
  expect(host.isNonCanonicalPublicHost("neweuropeanstrategies.com")).toBe(false);
  vi.stubGlobal("window", undefined);
  expect(host.browserPublicOrigin()).toBe(host.CANONICAL_SITE_ORIGIN);
});
