// Testy zachowan GiftArticleButton: fazy popovera (gosc / bez subskrypcji /
// uprawniony / limit miesieczny / wyczerpany budzet klikniec / wylaczone),
// idempotentne auto-generowanie linku i widocznosc budzetu. Warstwa danych
// (lib/gifting/hooks) jest mockowana - macierz faz ma wlasne testy w
// lib/gifting/__tests__/model.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { giftClickBudget } from "@/lib/gifting/model";
import type { GiftArticleState, GiftLinkResult, GiftSettings } from "@/lib/gifting/model";

const BASE_SETTINGS: GiftSettings = {
  enabled: true,
  monthly_limit: 0,
  link_ttl_days: 0,
  max_redemptions_per_link: 5,
  eligibility: "registered",
};

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  settings: {
    enabled: true,
    monthly_limit: 0,
    link_ttl_days: 0,
    max_redemptions_per_link: 5,
    eligibility: "registered",
  } as GiftSettings,
  state: null as GiftArticleState | null,
  stateLoading: false,
  stateError: false,
  refetch: vi.fn(),
  mutate: vi.fn(),
  mutationData: null as GiftLinkResult | null,
  mutationError: false,
  errorKey: null as "notGated" | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/lib/i18n-gifting", () => ({}));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session }),
}));

vi.mock("@/components/atoms/BrandIcon", () => ({
  BrandIcon: ({ alt }: { alt?: string }) => <span data-testid="brand-icon">{alt}</span>,
}));

// Data odnowienia budzetu pochodzi z modulu meteringu (jedno zrodlo prawdy dla
// "kiedy limit wraca") - w tescie wystarczy stabilna wartosc.
vi.mock("@/lib/access/metering", () => ({
  formatMeterResetDate: () => "1 września",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/gifting/hooks", () => ({
  useGiftSettings: () => ({ data: h.settings }),
  useGiftArticleState: () => ({
    data: h.state,
    isLoading: h.stateLoading,
    isError: h.stateError,
    refetch: h.refetch,
  }),
  useCreateGiftLink: () => ({
    mutation: {
      data: h.mutationData,
      isPending: false,
      isError: h.mutationError,
      mutate: h.mutate,
      reset: vi.fn(),
    },
    errorKey: h.errorKey,
  }),
}));

import { GiftArticleButton } from "@/components/gifting/GiftArticleButton";

const CODE = "abcDEF123_-xyzABC456pqr";

function makeState(partial: Partial<GiftArticleState>): GiftArticleState {
  return {
    enabled: true,
    canGift: true,
    requiresAuth: false,
    requiresSubscription: false,
    used: 0,
    monthlyLimit: 0,
    remaining: null,
    existingCode: null,
    expiresAt: null,
    eligibility: "registered",
    budget: giftClickBudget(0, 5),
    ...partial,
  };
}

function renderButton(props: { gated?: boolean } = {}) {
  return renderWithQueryClient(
    <GiftArticleButton
      postId="post-1"
      title="Tytuł wpisu"
      url="https://example.org/analizy/wpis"
      lang="pl"
      gated={props.gated ?? true}
    />,
  );
}

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "gifting.button" }));
}

beforeEach(() => {
  h.session = null;
  h.settings = { ...BASE_SETTINGS };
  h.state = null;
  h.stateLoading = false;
  h.stateError = false;
  h.mutationError = false;
  h.errorKey = null;
  h.refetch.mockClear();
  h.mutate.mockClear();
});

describe("GiftArticleButton", () => {
  it("nie renderuje niczego, gdy funkcja jest wylaczona w tenancie", () => {
    h.settings = { ...BASE_SETTINGS, enabled: false };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("gosc: popover pokazuje CTA logowania i rejestracji, bez generowania", () => {
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.authTitle")).toBeInTheDocument();
    const signIn = screen.getByRole("link", { name: "gifting.signIn" });
    expect(signIn).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "gifting.signUp" })).toBeInTheDocument();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("zalogowany bez platnej subskrypcji: CTA planow, bez generowania", () => {
    h.session = { user: { id: "u1" } };
    h.settings = { ...BASE_SETTINGS, eligibility: "subscribers" };
    h.state = makeState({
      canGift: false,
      requiresSubscription: true,
      eligibility: "subscribers",
    });
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.subscriptionTitle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gifting.seePlans" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("zalogowany czytelnik bez linku: otwarcie popovera auto-generuje dokladnie raz", () => {
    h.session = { user: { id: "u1" } };
    h.state = makeState({});
    renderButton();
    openPopover();
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("gifting.preparing")).toBeInTheDocument();
  });

  it("uprawniony z istniejacym kodem: budzet, kanaly i kopiowanie, bez ponownego create", () => {
    h.session = { user: { id: "u1" } };
    h.state = makeState({ existingCode: CODE, budget: giftClickBudget(2, 5) });
    renderButton();
    openPopover();
    expect(h.mutate).not.toHaveBeenCalled();
    // Budzet klikniec widoczny dla nadawcy: 2 z 5 zuzyte, 3 zostaly.
    expect(screen.getByTestId("gift-budget")).toHaveAttribute("data-remaining", "3");
    expect(screen.getByTestId("quota-meter")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("gifting.unlimitedNote")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gifting.copyLink" })).toBeInTheDocument();
    const fb = screen.getByRole("link", { name: "gifting.channels.facebook" });
    expect(fb).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(`https://example.org/analizy/wpis?gift=${CODE}`)),
    );
    // 7 kanalow platformy: mail, facebook, linkedin, whatsapp, telegram, x, reddit.
    expect(screen.getAllByTestId("brand-icon")).toHaveLength(7);
    // Stopka mowi prawde o mechanice: pierwszych N czytelnikow, nie "kazdy".
    expect(screen.getByText(/gifting.firstNCanRead/)).toBeInTheDocument();
  });

  it("wyczerpany budzet klikniec: stan terminalny zamiast martwego 'skopiuj link'", () => {
    h.session = { user: { id: "u1" } };
    h.state = makeState({ existingCode: CODE, budget: giftClickBudget(5, 5) });
    renderButton();
    openPopover();
    expect(screen.getByTestId("gift-budget-spent")).toBeInTheDocument();
    expect(screen.getByText("gifting.budget.spentTitle")).toBeInTheDocument();
    expect(screen.getByText(/gifting.budget.resetsOn/)).toBeInTheDocument();
    expect(screen.queryByTestId("gift-copy-button")).not.toBeInTheDocument();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("blad odczytu stanu: komunikat + ponowienie (bez wiecznego 'preparing')", () => {
    h.session = { user: { id: "u1" } };
    h.stateError = true;
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.errors.unknown")).toBeInTheDocument();
    expect(screen.queryByText("gifting.preparing")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("limit miesieczny: licznik pozostalych i komunikat o wyczerpaniu", () => {
    h.session = { user: { id: "u1" } };
    h.state = makeState({ monthlyLimit: 5, used: 5, remaining: 0 });
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.limitTitle")).toBeInTheDocument();
    expect(screen.getByText(/gifting.limitDesc/)).toBeInTheDocument();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("artykuł bez paywalla pozwala skopiować zwykły link zamiast ponawiać", async () => {
    h.session = { user: { id: "u1" } };
    h.state = makeState({});
    h.mutationError = true;
    h.errorKey = "notGated";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderButton();
    openPopover();
    expect(screen.queryByRole("button", { name: "common.retry" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "gifting.copyLink" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.org/analizy/wpis");
      expect(screen.getByRole("button", { name: "gifting.copied" })).toBeInTheDocument();
    });
  });
});
