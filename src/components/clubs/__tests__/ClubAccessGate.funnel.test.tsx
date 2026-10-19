// Bramka klubu w lejku czytelnika (S3): hydratacja (AGENTS: `useHydrated`),
// powrót po logowaniu (P15, `intent=club`), pomiar uderzenia (P18:
// `record_paywall_hit` bez zgody, zdarzenia klienta tylko przy zgodzie)
// i kontekst planu (kasa wraca do klubu).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  auth: { session: null as { user: { id: string } } | null, loading: false },
  hydrated: true,
  rpc: vi.fn(),
  visitorHit: vi.fn(),
  track: vi.fn(),
  consent: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    hash: _hash,
    onClick,
  }: {
    children?: ReactNode;
    to: string;
    search?: Record<string, string>;
    hash?: string;
    onClick?: () => void;
  }) => {
    const query = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={query ? `${to}?${query}` : to} onClick={onClick}>
        {children}
      </a>
    );
  },
  useHydrated: () => h.hydrated,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/profile/badges", () => ({ useUserBadges: () => ({ data: [] }) }));
vi.mock("@/lib/billing/tiers", () => ({ useMembershipTiers: () => ({ data: undefined }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signUp: vi.fn() }, rpc: (n: string, a: unknown) => h.rpc(n, a) },
}));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: vi.fn() }));
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/i18n-club-gate", () => ({}));
vi.mock("@/lib/auth/registrationFields", () => ({
  buildSignupMetadata: () => ({}),
  useRegistrationFields: () => ({
    isEnabled: (key: string) => ["email", "password", "newsletter_optin"].includes(key),
    isRequired: (key: string) => ["email", "password"].includes(key),
    label: (_key: string, fallback: string) => fallback,
    visible: [],
  }),
}));
vi.mock("@/lib/access/paywallHits.functions", () => ({
  recordPaywallHitVisitor: (input: unknown) => h.visitorHit(input),
}));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => h.consent }));

import { ClubAccessGate } from "@/components/clubs/organisms/ClubAccessGate";
import { clubViewRow } from "@/test/clubs/fixtures";

beforeEach(() => {
  h.auth = { session: null, loading: false };
  h.hydrated = true;
  h.consent = true;
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.visitorHit.mockReset().mockResolvedValue(true);
  h.track.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/club/klub-energetyczny");
});

describe("ClubAccessGate - hydratacja (AGENTS)", () => {
  it("przed hydratacją ustalona sesja NIE podmienia znaczników gościa", () => {
    h.hydrated = false;
    h.auth = { session: { user: { id: "u1" } }, loading: false };
    render(<ClubAccessGate club={clubViewRow({ reason: "tier_too_low" })} />);
    expect(screen.getByText("clubGate.signupTitle")).toBeInTheDocument();
    expect(screen.queryByText("clubGate.lockedTitle")).toBeNull();
    // Bez hydratacji nie ma też pomiaru ani `next` (SSR nie zna `window`).
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.visitorHit).not.toHaveBeenCalled();
    const href = screen.getByRole("link", { name: "clubGate.signIn" }).getAttribute("href");
    expect(href).toBe("/login?mode=signin&intent=club");
  });
});

describe("ClubAccessGate - lejek", () => {
  it("gość: logowanie wraca do klubu; uderzenie przez server fn", async () => {
    const club = clubViewRow();
    render(<ClubAccessGate club={club} />);
    const url = new URL(
      screen.getByRole("link", { name: "clubGate.signIn" }).getAttribute("href") ?? "",
      "https://x.test",
    );
    expect(url.searchParams.get("next")).toBe("/club/klub-energetyczny");
    expect(url.searchParams.get("intent")).toBe("club");
    await waitFor(() =>
      expect(h.visitorHit).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "club",
          entityId: club.id,
          reason: "members",
        }),
      }),
    );
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({ type: "paywall_view", entityType: "club" }),
    );
  });

  it("zgoda newsletterowa domyślnie odznaczona (P08)", () => {
    render(<ClubAccessGate club={clubViewRow()} />);
    expect(screen.getByRole("checkbox").getAttribute("data-state")).toBe("unchecked");
  });

  it("zalogowany z planem za niskim: RPC z progiem, upgrade pamięta klub", async () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };
    const club = clubViewRow({ reason: "tier_too_low" });
    render(<ClubAccessGate club={club} />);
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith(
        "record_paywall_hit",
        expect.objectContaining({
          p_entity_type: "club",
          p_entity_id: club.id,
          p_reason: "tier_rank",
        }),
      ),
    );
    fireEvent.click(screen.getByRole("link", { name: /clubGate\.upgradeCta/ }));
    expect(window.sessionStorage.getItem("checkout:returnTo")).toBe("/club/klub-energetyczny");
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "paywall_cta_click",
        meta: expect.objectContaining({ cta: "upgrade", surface: "club_gate" }),
      }),
    );
  });

  it("bez zgody analitycznej: zero zdarzeń klienta, licznik serwera działa", async () => {
    h.consent = false;
    render(<ClubAccessGate club={clubViewRow()} />);
    await waitFor(() => expect(h.visitorHit).toHaveBeenCalled());
    expect(h.track).not.toHaveBeenCalled();
  });
});
