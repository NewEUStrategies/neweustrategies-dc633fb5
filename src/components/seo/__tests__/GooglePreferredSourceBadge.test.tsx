import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  GOOGLE_SOURCE_BADGE_DEFAULTS,
  alignClass,
  clampLogoSize,
  clampMargin,
  googlePreferredSourceUrl,
  isBadgeVisible,
  placementStyle,
  resolveBadgeHref,
  resolveBadgeLogo,
  type GoogleSourceBadgeConfig,
} from "@/lib/seo/googleSourceBadge";
import { GooglePreferredSourceBadge } from "../GooglePreferredSourceBadge";

const trackMock = vi.fn();
vi.mock("@/lib/analytics/track", () => ({ track: (e: unknown) => trackMock(e) }));

const cfg = (patch: Partial<GoogleSourceBadgeConfig> = {}): GoogleSourceBadgeConfig => ({
  ...GOOGLE_SOURCE_BADGE_DEFAULTS,
  ...patch,
});

describe("googleSourceBadge config", () => {
  it("wybiera adres per język i spada do domyślnego", () => {
    const config = cfg({ url_pl: "https://pl.example", url_en: "  " });
    expect(resolveBadgeHref(config, "pl")).toBe("https://pl.example");
    expect(resolveBadgeHref(config, "en-GB")).toBe(googlePreferredSourceUrl());
  });

  it("dobiera logo do motywu z fallbackiem", () => {
    expect(resolveBadgeLogo({ light: "l.png", dark: "", size: 14 }, "dark")).toBe("l.png");
    expect(resolveBadgeLogo({ light: "l.png", dark: "d.png", size: 14 }, "dark")).toBe("d.png");
    expect(resolveBadgeLogo({ light: "", dark: "", size: 14 }, "light")).toBeNull();
  });

  it("ogranicza marginesy i rozmiar sygnetu", () => {
    expect(clampMargin(999)).toBe(48);
    expect(clampMargin(-5)).toBe(0);
    expect(clampMargin("abc")).toBe(0);
    expect(clampLogoSize(4)).toBe(10);
    expect(clampLogoSize(99)).toBe(32);
  });

  it("mapuje wyrównanie i marginesy na style", () => {
    expect(alignClass("center")).toBe("justify-center");
    expect(
      placementStyle({
        enabled: true,
        variant: "compact",
        align: "start",
        marginTop: 8,
        marginBottom: 4,
        marginX: 2,
      }),
    ).toEqual({ marginTop: 8, marginBottom: 4, marginLeft: 2, marginRight: 2 });
  });

  it("respektuje włącznik globalny i per breakpoint", () => {
    expect(isBadgeVisible(cfg(), "desktop")).toBe(true);
    expect(isBadgeVisible(cfg({ enabled: false }), "desktop")).toBe(false);
    expect(
      isBadgeVisible(cfg({ mobile: { ...GOOGLE_SOURCE_BADGE_DEFAULTS.mobile, enabled: false } }), "mobile"),
    ).toBe(false);
  });
});

describe("GooglePreferredSourceBadge", () => {
  beforeEach(() => trackMock.mockClear());

  it("nie renderuje się, gdy badge jest wyłączony", () => {
    const { container } = render(
      <GooglePreferredSourceBadge configOverride={cfg({ enabled: false })} />,
    );
    expect(container.querySelector("[data-google-preferred-source]")).toBeNull();
  });

  it("raportuje kliknięcie jako zdarzenie analityczne", () => {
    render(<GooglePreferredSourceBadge configOverride={cfg()} entityId="post-1" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", googlePreferredSourceUrl());
    fireEvent.click(link);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "google_preferred_source_click",
        entityId: "post-1",
        meta: expect.objectContaining({ device: "desktop", variant: "default" }),
      }),
    );
  });
});
