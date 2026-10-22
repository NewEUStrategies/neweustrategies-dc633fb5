// AccountMenuWidget: automatyczna sekcja staff, pozycje zewnętrzne i adresy
// własnych pozycji menu.
//
// Co udowadniamy i dlaczego:
//   * Admin i super-admin ZAWSZE mają drogę do paneli zarządzania, także gdy
//     redakcja nie skonfigurowała sekcji staff (auto-pozycje /admin i
//     /admin/users), a pozycja skonfigurowana pod tym samym adresem nie
//     dubluje się. Staff bez tych ról i bez pozycji nie dostaje pustego
//     nagłówka sekcji.
//   * Pozycja oznaczona jako zewnętrzna otwiera się w nowej karcie z
//     `noopener` i zamyka panel po kliknięciu.
//   * Adres pozycji „custom" przechodzi przez safeUrl: `javascript:`/`data:` nie
//     trafia do nagłówka strony (wcześniej szedł do <a href> bez filtra -
//     naprawione 2026-10-18); pozycja bez bezpiecznego adresu nie renderuje się.
//
// Granice: jak w accountMenuWidget.test.tsx - useAuth (role), profil nagłówka,
// powitanie, dzwonki, klient Supabase (indeks stron) i react-i18next są
// atrapami; zestaw panelu (Popover/Avatar) jest prawdziwy i rozgrzany przed
// przypadkami, żeby `use()` czytał go synchronicznie.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { AccountMenuWidget, type AccountMenuConfig } from "../AccountMenuWidget";

const auth = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  user: { id: "u1", email: "anna@example.org" } as { id: string; email: string } | null,
  signOut: vi.fn(async () => {}),
  isStaff: true,
  isAdmin: false,
  isSuperAdmin: false,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useHasMounted", () => ({ useHasMounted: () => true }));
vi.mock("@/lib/profile/useHeaderProfile", () => ({
  useHeaderProfile: () => ({
    data: { first_name: "Anna", display_name: "Anna Kowalska", avatar_url: null },
  }),
}));
vi.mock("@/lib/greetings/useGreeting", () => ({ useGreeting: () => "" }));
vi.mock("@/components/notifications/NotificationsBell", () => ({
  NotificationsBell: () => null,
}));
vi.mock("@/components/events/participant/molecules/AccountMenuEventsSection", () => ({
  AccountMenuEventsSection: () => null,
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "in", "limit"]) chain[m] = () => chain;
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({ data: [], error: null }).then(onF);
  return { supabase: chain };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl", changeLanguage: () => {} },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function renderWidget(config: AccountMenuConfig, lang: "pl" | "en" = "pl") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountMenuWidget config={config} lang={lang} />
    </QueryClientProvider>,
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
}

beforeAll(async () => {
  const view = renderWidget({});
  await act(async () => {
    await Promise.all([
      import("@/components/ui/popover"),
      import("@/components/ui/avatar"),
      import("@/lib/greetings/useGreeting"),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  view.unmount();
});

beforeEach(() => {
  cleanup();
  auth.isStaff = true;
  auth.isAdmin = false;
  auth.isSuperAdmin = false;
});

describe("AccountMenuWidget - automatyczna sekcja staff", () => {
  it("admin + super-admin bez konfiguracji dostają /admin i /admin/users", async () => {
    auth.isAdmin = true;
    auth.isSuperAdmin = true;
    renderWidget({ items: [] });
    openPanel();
    expect((await screen.findByText("Panel admina")).closest("a")).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(screen.getByText("Super admin - użytkownicy").closest("a")).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(screen.getByText("Zarządzanie rolami i wcielanie się")).toBeInTheDocument();
  });

  it("pozycja staff pod tym samym adresem co auto-pozycja nie dubluje się", async () => {
    auth.isAdmin = true;
    renderWidget({
      items: [
        { id: "s1", section: "staff", kind: "custom", customHref: "/admin", label_pl: "Kokpit" },
        { id: "s2", section: "staff", kind: "custom", customHref: "/admin/cms", label_pl: "CMS" },
      ],
    });
    openPanel();
    await screen.findByText("Panel admina");
    expect(document.querySelectorAll('a[href="/admin"]')).toHaveLength(1);
    expect(screen.queryByText("Kokpit")).not.toBeInTheDocument();
    expect(screen.getByText("CMS").closest("a")).toHaveAttribute("href", "/admin/cms");
  });

  it("staff bez ról admina i bez pozycji nie dostaje pustej sekcji (EN)", async () => {
    renderWidget({ items: [] }, "en");
    openPanel();
    await screen.findByText("Sign out");
    expect(screen.queryByText("Admin panel")).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/admin"]')).toBeNull();
  });
});

describe("AccountMenuWidget - adresy pozycji własnych", () => {
  it("pozycja zewnętrzna otwiera nową kartę z noopener i zamyka panel", async () => {
    renderWidget({
      items: [
        {
          id: "e1",
          section: "auth",
          kind: "custom",
          customHref: "https://docs.example.org",
          label_pl: "Dokumentacja",
          external: true,
        },
      ],
    });
    openPanel();
    const link = (await screen.findByText("Dokumentacja")).closest("a") as HTMLAnchorElement;
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // Bez nawigacji happy-dom (otwarcie karty = prawdziwe żądanie sieciowe).
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByText("Dokumentacja")).not.toBeInTheDocument());
  });

  it("niebezpieczny adres pozycji (javascript:/data:) nie trafia do menu", async () => {
    renderWidget({
      items: [
        {
          id: "x1",
          section: "auth",
          kind: "custom",
          customHref: "javascript:alert(document.cookie)",
          label_pl: "Pułapka",
          external: true,
        },
        {
          id: "x2",
          section: "auth",
          kind: "custom",
          customHref: "data:text/html,<script>alert(1)</script>",
          label_pl: "Pułapka 2",
        },
        { id: "x3", section: "auth", kind: "custom", customHref: "/ok", label_pl: "Bezpieczna" },
      ],
    });
    openPanel();
    expect((await screen.findByText("Bezpieczna")).closest("a")).toHaveAttribute("href", "/ok");
    expect(screen.queryByText("Pułapka")).not.toBeInTheDocument();
    expect(screen.queryByText("Pułapka 2")).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"], a[href^="data:"]')).toBeNull();
  });
});

describe("AccountMenuWidget - adresy logowania gościa", () => {
  it("niebezpieczny signinHref/signupHref spada na adresy domyślne", async () => {
    auth.session = null;
    auth.user = null;
    try {
      renderWidget({ signinHref: "javascript:alert(1)", signupHref: "data:text/html,x" });
      fireEvent.click(screen.getByRole("button", { name: /Zaloguj/ }));
      await waitFor(() => expect(document.querySelector('a[href="/login"]')).not.toBeNull());
      expect(document.querySelector('a[href="/login?mode=signup"]')).not.toBeNull();
      expect(document.querySelector('a[href^="javascript:"], a[href^="data:"]')).toBeNull();
    } finally {
      auth.session = { user: { id: "u1" } };
      auth.user = { id: "u1", email: "anna@example.org" };
    }
  });
});
