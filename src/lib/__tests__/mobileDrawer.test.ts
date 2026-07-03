import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRAWER_CONFIG,
  drawerConfigSchema,
  parseDrawerConfig,
  sectionOrderSchema,
  navItemSchema,
} from "@/lib/mobileDrawer";

describe("mobileDrawer schemas", () => {
  it("accepts the default config", () => {
    expect(drawerConfigSchema.parse(DEFAULT_DRAWER_CONFIG)).toEqual(DEFAULT_DRAWER_CONFIG);
  });

  it("rejects section_order duplicates", () => {
    expect(() =>
      sectionOrderSchema.parse(["top_tools", "top_tools", "account", "nav"]),
    ).toThrow();
  });

  it("rejects unknown section names", () => {
    expect(() => sectionOrderSchema.parse(["top_tools", "wat"])).toThrow();
  });

  it("accepts either absolute path or full URL for href", () => {
    expect(navItemSchema.parse({ id: "a", label_pl: "A", label_en: "A", href: "/blog", icon: "link", enabled: true }).href).toBe("/blog");
    expect(navItemSchema.parse({ id: "a", label_pl: "A", label_en: "A", href: "https://example.com", icon: "link", enabled: true }).href).toBe("https://example.com");
    expect(() =>
      navItemSchema.parse({ id: "a", label_pl: "A", label_en: "A", href: "blog", icon: "link", enabled: true }),
    ).toThrow();
  });

  it("parseDrawerConfig falls back to defaults on garbage input", () => {
    expect(parseDrawerConfig(null)).toEqual(DEFAULT_DRAWER_CONFIG);
    expect(parseDrawerConfig({ section_order: "wat" })).toEqual(DEFAULT_DRAWER_CONFIG);
    expect(parseDrawerConfig({ section_order: ["top_tools"], top_tools: "x", nav_items: [] })).toEqual(
      DEFAULT_DRAWER_CONFIG,
    );
  });
});
