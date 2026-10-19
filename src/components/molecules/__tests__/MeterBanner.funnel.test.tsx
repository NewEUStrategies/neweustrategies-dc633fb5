// MeterBanner w lejku czytelnika (S3): rejestracja z licznika wraca na ten
// artykuł (P15: `next` + `intent=meter`), a kliknięcia CTA mierzą się
// wyłącznie przy zgodzie analitycznej (P18).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { meterState } from "@/test/paywall/fixtures";
import { translateKey as k } from "@/test/network/fixtures";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  track: vi.fn(),
  consent: true,
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    search,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => {
    const query = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={query ? `${to}?${query}` : to} {...rest}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/lib/access/metering", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access/metering")>()),
  useMeterQuota: () => ({ data: undefined }),
}));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => h.consent }));

import { MeterBanner } from "@/components/molecules/MeterBanner";

beforeEach(() => {
  h.session = null;
  h.consent = true;
  h.track.mockReset();
  window.history.replaceState({}, "", "/analizy/tekst?utm=x");
});

describe("MeterBanner - lejek", () => {
  it("rejestracja niesie powrót na artykuł i intencję licznika", () => {
    render(<MeterBanner meter={meterState()} />);
    const href = screen
      .getByRole("link", { name: k("paywall.meter.createAccount") })
      .getAttribute("href");
    const url = new URL(href ?? "", "https://x.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("mode")).toBe("signup");
    expect(url.searchParams.get("next")).toBe("/analizy/tekst?utm=x");
    expect(url.searchParams.get("intent")).toBe("meter");
  });

  it("klik CTA mierzy się przy zgodzie, bez zgody - nie", () => {
    render(<MeterBanner meter={meterState()} />);
    fireEvent.click(screen.getByRole("link", { name: k("paywall.meter.seePlans") }));
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "paywall_cta_click",
        meta: expect.objectContaining({ cta: "pricing", surface: "meter" }),
      }),
    );
    h.track.mockReset();
    h.consent = false;
    fireEvent.click(screen.getByRole("link", { name: k("paywall.meter.createAccount") }));
    expect(h.track).not.toHaveBeenCalled();
  });
});
