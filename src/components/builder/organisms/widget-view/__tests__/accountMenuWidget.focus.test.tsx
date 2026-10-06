// AccountMenuWidget: fokus gościa przy ZIMNYM zestawie panelu (P2.3, recenzja m2).
//
// Przypinany kontrakt: gość, który aktywuje przycisk „Zaloguj | Zarejestruj"
// z klawiatury, zanim zestaw panelu (Popover i Avatar Radixa, silnik powitań)
// zdążył się załadować, zachowuje fokus na TYM SAMYM węźle przycisku przez
// cały import - fokus nie spada na `<body>`. Po imporcie menu otwiera się, a
// fokus przechodzi do jego treści; Escape zamyka menu i oddaje fokus
// wyzwalaczowi.
//
// Zestaw to stan modułu (jeden import na dokument), dlatego ten przypadek ma
// własny plik: import `popover` czeka tu na ręcznie zwalnianą bramkę, więc
// stan „zestaw w drodze" trwa dokładnie tyle, ile chce test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountMenuWidget, type AccountMenuConfig } from "../AccountMenuWidget";

const gate = vi.hoisted(() => {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release(), imported: 0 };
});

vi.mock("@/components/ui/popover", async (importOriginal) => {
  gate.imported += 1;
  await gate.opened;
  return importOriginal();
});
vi.mock("@/lib/greetings/useGreeting", () => ({ useGreeting: () => null }));
vi.mock("@/integrations/supabase/sessionHint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/supabase/sessionHint")>()),
  hasStoredAuthSession: () => false,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: null,
    user: null,
    signOut: async () => {},
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
  }),
}));
vi.mock("@/lib/profile/useHeaderProfile", () => ({ useHeaderProfile: () => ({ data: null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "pl", changeLanguage: () => {} },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const CONFIG: AccountMenuConfig = {
  signin_pl: "Zaloguj",
  signup_pl: "Załóż konto",
  items: [
    { id: "g1", section: "guest", kind: "custom", customHref: "/pricing", label_pl: "Cennik" },
  ],
};
const TRIGGER = { name: "Zaloguj / Załóż konto" };

/** Mikrozadania i makrozadanie: import zestawu zdążyłby się rozstrzygnąć. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
});

describe("AccountMenuWidget - fokus gościa przy zimnym zestawie (P2.3)", () => {
  it("Enter przed importem zestawu: fokus zostaje na tym samym przycisku, potem wchodzi do menu", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountMenuWidget config={CONFIG} lang="pl" />
      </QueryClientProvider>,
    );
    const button = screen.getByRole("button", TRIGGER);
    button.focus();
    expect(document.activeElement).toBe(button);

    // Aktywacja z klawiatury (Enter na przycisku = `click`) przy zimnym zestawie.
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    await settle();
    expect(gate.imported).toBe(1);
    // Import w drodze: ten sam węzeł w dokumencie, nadal z fokusem, menu zamknięte.
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Cennik")).toBeNull();

    await act(async () => {
      gate.release();
    });
    const item = await screen.findByText("Cennik");
    const menu = item.closest("[data-account-menu]");
    expect(menu).not.toBeNull();
    expect(screen.getByRole("button", TRIGGER)).toHaveAttribute("aria-expanded", "true");
    // Fokus w treści menu (Radix), nie na `<body>`.
    expect(document.activeElement).not.toBe(document.body);
    expect(menu?.contains(document.activeElement)).toBe(true);

    // Escape zamyka menu i oddaje fokus wyzwalaczowi.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await settle();
    const trigger = screen.getByRole("button", TRIGGER);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });
});
