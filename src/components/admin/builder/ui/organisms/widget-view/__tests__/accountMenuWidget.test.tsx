// AccountMenuWidget: menu konta w chrome nagłówka. Przypinane kontrakty:
// stan gościa (Zaloguj | Załóż konto), stan zalogowanego (powitanie + panel
// z sekcjami auth/staff), rozwiązywanie pozycji (preset -> href, custom,
// separator, strona z indeksu pages), wylogowanie przez signOut.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

import { AccountMenuWidget, type AccountMenuConfig } from "../AccountMenuWidget";

const auth = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  user: null as { id: string; email: string } | null,
  signOut: vi.fn(async () => {}),
  isStaff: false,
  isAdmin: false,
  isSuperAdmin: false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => auth,
}));
vi.mock("@/hooks/useHasMounted", () => ({ useHasMounted: () => true }));
vi.mock("@/lib/profile/useHeaderProfile", () => ({
  useHeaderProfile: () => ({
    data: auth.user
      ? { first_name: "Anna", display_name: "Anna Kowalska", avatar_url: null }
      : null,
  }),
}));
vi.mock("@/lib/greetings/useGreeting", () => ({
  useGreeting: () => (auth.user ? "Dzień dobry, Anno" : ""),
}));
vi.mock("@/components/notifications/NotificationsBell", () => ({
  NotificationsBell: () => <span data-testid="bell" />,
}));
vi.mock("@/components/chat/ChatBell", () => ({
  ChatBell: () => <span data-testid="chat-bell" />,
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "in", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({
      data: [{ slug: "o-nas", title_pl: "O nas", title_en: "About us" }],
      error: null,
    }).then(onF);
  return { supabase: chain };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl", changeLanguage: () => {} },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const CONFIG: AccountMenuConfig = {
  signin_pl: "Zaloguj",
  signup_pl: "Załóż konto",
  logout_pl: "Wyloguj się",
  items: [
    { id: "i1", section: "guest", kind: "custom", customHref: "/pricing", label_pl: "Cennik" },
    { id: "i2", section: "auth", kind: "preset", presetKey: "profile" },
    { id: "i3", section: "auth", kind: "separator" },
    { id: "i4", section: "auth", kind: "page", pageSlug: "o-nas" },
    { id: "i5", section: "auth", kind: "logout", label_pl: "Wyloguj się" },
    { id: "i6", section: "staff", kind: "preset", presetKey: "admin" },
  ],
};

function renderWidget() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountMenuWidget config={CONFIG} lang="pl" />
    </QueryClientProvider>,
  );
}

describe("AccountMenuWidget", () => {
  beforeEach(() => {
    cleanup();
    auth.session = null;
    auth.user = null;
    auth.isStaff = false;
    auth.isAdmin = false;
    auth.isSuperAdmin = false;
    auth.signOut.mockClear();
  });

  it("gość widzi Zaloguj | Załóż konto, a panel zawiera pozycje sekcji guest", async () => {
    renderWidget();
    const trigger = screen.getByRole("button", { name: "Zaloguj / Załóż konto" });
    expect(trigger).toHaveTextContent("Zaloguj");
    expect(trigger).toHaveTextContent("Załóż konto");

    fireEvent.click(trigger);
    const cennik = await screen.findByText("Cennik");
    expect(cennik.closest("a")).toHaveAttribute("href", "/pricing");
    expect(screen.queryByText("Mój profil")).not.toBeInTheDocument();
  });

  it("zalogowany widzi powitanie, sekcję auth (preset + strona) i wylogowanie", async () => {
    auth.session = { user: { id: "u1" } };
    auth.user = { id: "u1", email: "anna@example.org" };
    renderWidget();

    const trigger = screen.getByRole("button", { name: "Anna Kowalska" });
    expect(trigger).toHaveTextContent("Dzień dobry, Anno");
    fireEvent.click(trigger);

    const profil = await screen.findByText("Mój profil");
    expect(profil.closest("a")).toHaveAttribute("href", "/profile");
    // Strona z indeksu pages rozwiązuje się do /slug z tytułem PL.
    await waitFor(() => {
      expect(screen.getByText("O nas").closest("a")).toHaveAttribute("href", "/o-nas");
    });
    // Separator sekcji jest obecny.
    expect(document.querySelector('[role="separator"]')).toBeTruthy();
    // Bez roli staff sekcja staff nie renderuje się.
    expect(screen.queryByText("Panel admina")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Wyloguj się"));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  it("staff dostaje dodatkowo sekcję staff (Panel admina)", async () => {
    auth.session = { user: { id: "u2" } };
    auth.user = { id: "u2", email: "staff@example.org" };
    auth.isStaff = true;
    renderWidget();
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    const admin = await screen.findByText("Panel admina");
    expect(admin.closest("a")).toHaveAttribute("href", "/admin");
  });
});
