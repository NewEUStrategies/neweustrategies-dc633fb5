// Testy zachowan GiftArticleButton: fazy popovera (gosc / bez subskrypcji /
// subskrybent / limit / wylaczone) + idempotentne auto-generowanie linku.
// Warstwa danych (lib/gifting/hooks) jest mockowana - macierz faz ma wlasne
// testy w lib/gifting/__tests__/model.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { GiftArticleState, GiftLinkResult, GiftSettings } from "@/lib/gifting/model";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  settings: { enabled: true, monthly_limit: 0, link_ttl_days: 0 } as GiftSettings,
  state: null as GiftArticleState | null,
  stateLoading: false,
  stateError: false,
  refetch: vi.fn(),
  mutate: vi.fn(),
  mutationData: null as GiftLinkResult | null,
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
      isError: false,
      mutate: h.mutate,
    },
    errorKey: null,
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
    ...partial,
  };
}

function renderButton() {
  return renderWithQueryClient(
    <GiftArticleButton
      postId="post-1"
      title="Tytuł wpisu"
      url="https://example.org/analizy/wpis"
      lang="pl"
    />,
  );
}

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "gifting.button" }));
}

beforeEach(() => {
  h.session = null;
  h.settings = { enabled: true, monthly_limit: 0, link_ttl_days: 0 };
  h.state = null;
  h.stateLoading = false;
  h.stateError = false;
  h.refetch.mockClear();
  h.mutate.mockClear();
});

describe("GiftArticleButton", () => {
  it("nie renderuje niczego, gdy funkcja jest wylaczona w tenancie", () => {
    h.settings = { enabled: false, monthly_limit: 0, link_ttl_days: 0 };
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
    h.state = makeState({ canGift: false, requiresSubscription: true });
    renderButton();
    openPopover();
    expect(screen.getByText("gifting.subscriptionTitle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gifting.seePlans" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("subskrybent bez linku: otwarcie popovera auto-generuje dokladnie raz", () => {
    h.session = { user: { id: "u1" } };
    h.state = makeState({});
    renderButton();
    openPopover();
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("gifting.preparing")).toBeInTheDocument();
  });

  it("subskrybent z istniejacym kodem: kanaly + kopiowanie, bez ponownego create", () => {
    h.session = { user: { id: "u1" } };
    h.state = makeState({ existingCode: CODE });
    renderButton();
    openPopover();
    expect(h.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("gifting.unlimitedNote")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gifting.copyLink" })).toBeInTheDocument();
    const fb = screen.getByRole("link", { name: "gifting.channels.facebook" });
    expect(fb).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(`https://example.org/analizy/wpis?gift=${CODE}`)),
    );
    // 7 kanalow platformy: mail, facebook, linkedin, whatsapp, telegram, x, reddit.
    expect(screen.getAllByTestId("brand-icon")).toHaveLength(7);
    expect(screen.getByText(/gifting.anyoneCanRead/)).toBeInTheDocument();
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
});
