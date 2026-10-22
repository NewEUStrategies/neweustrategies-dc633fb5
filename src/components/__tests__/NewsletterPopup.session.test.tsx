// P17 (S3): popup REJESTRACJI konta nie zaprasza do konta kogoś, kto jest
// zalogowany. Bramka czyta sesję z `useAuth`; zalogowany nie wywołuje nawet
// prośby o slot nakładki (żadnego `impression`, żadnego `requestOverlaySlot`).
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  settings: null as unknown,
  requestSlot: vi.fn<(id: string, opts: Record<string, unknown>) => Promise<() => void>>(),
  cancelSlot: vi.fn<(id: string) => void>(),
  track: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-signup-popup", () => ({}));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/artykul/x" }) }));
vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: "light", toggle: () => {}, setTheme: () => {} }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session, loading: false }) }));
vi.mock("@/lib/overlayCoordinator", () => ({
  requestOverlaySlot: h.requestSlot,
  cancelOverlayRequest: h.cancelSlot,
}));
vi.mock("@/lib/newsletter/popupTelemetry", () => ({
  trackNewsletterPopupEvent: h.track,
  newsletterPopupSessionId: () => "test-session",
}));
vi.mock("@/lib/newsletter/popupContent", () => ({
  loadPopupContent: () => Promise.resolve({}),
}));
vi.mock("@/lib/newsletter/popupImages", () => ({
  warmPopupImages: () => {},
  POPUP_COVER_SIZES: "",
  POPUP_SIDE_SIZES: "",
}));
vi.mock("@/hooks/useNewsletterSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useNewsletterSettings")>()),
  useNewsletterSettings: () => ({ data: h.settings }),
}));
vi.mock("@/components/popups/SignupPopupPanel", () => ({ SignupPopupPanel: () => null }));

import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";

async function mount() {
  h.settings = {
    ...defaultNewsletterSettings(),
    popup_enabled: true,
    popup_trigger: "delay",
    popup_delay_seconds: 5,
  };
  vi.resetModules();
  const { NewsletterPopup } = await import("@/components/NewsletterPopup");
  render(<NewsletterPopup />);
  await act(async () => {
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  h.session = null;
  h.requestSlot.mockReset().mockReturnValue(new Promise(() => {}));
  h.cancelSlot.mockReset();
  h.track.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NewsletterPopup - sesja (P17)", () => {
  it("zalogowany: zero zaproszenia (ani impression, ani prośby o slot)", async () => {
    h.session = { user: { id: "u1" } };
    await mount();
    expect(h.track).not.toHaveBeenCalled();
    expect(h.requestSlot).not.toHaveBeenCalled();
  });

  it("gość: popup kwalifikuje się i prosi o slot jak dotąd", async () => {
    await mount();
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ event: "impression" }));
    await act(async () => {
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });
    expect(h.requestSlot).toHaveBeenCalledWith("newsletter-popup", expect.anything());
  });
});
