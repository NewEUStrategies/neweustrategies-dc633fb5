// AccountMenuWidget na intencję (P2.3): gość dostaje statyczny przycisk, a
// zestaw panelu (Popover i Avatar Radixa, silnik powitań) przychodzi
// dynamicznym importem dopiero przy intencji.
//
// Przypinane kontrakty:
//  1. HTML serwera przycisku gościa jest bajt w bajt tym, który dotąd składał
//     `PopoverTrigger asChild` Radixa (parytet hydratacji i te same atrybuty
//     ARIA), a render serwera ani hydratacja gościa NIE importują zestawu;
//  2. najechanie rozgrzewa zestaw, a kliknięcie otwiera menu z pozycjami gościa.
// Zalogowany (zestaw przy montażu): `accountMenuWidget.session.test.tsx`.
//
// Zestaw to stan modułu (jeden import na dokument), więc przypadki biegną W TEJ
// KOLEJNOŚCI na jednej instancji modułu: najpierw dowód braku importu, potem
// rozgrzewka, na końcu otwarcie z gotowego zestawu. Otwarcie liczy na
// rozgrzewkę także dlatego, że w środowisku `act` React nie ponawia granicy
// zawieszonej na promise rozstrzygniętym poza renderem (w przeglądarce
// ponawia - pokrywa to e2e `header-intent`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import type { ReactElement } from "react";
import { AccountMenuWidget, type AccountMenuConfig } from "../AccountMenuWidget";

const kit = vi.hoisted(() => ({ imported: [] as string[] }));

vi.mock("@/components/ui/popover", async (importOriginal) => {
  kit.imported.push("popover");
  return importOriginal();
});
vi.mock("@/components/ui/avatar", async (importOriginal) => {
  kit.imported.push("avatar");
  return importOriginal();
});
vi.mock("@/lib/greetings/useGreeting", () => {
  kit.imported.push("greeting");
  return { useGreeting: () => null };
});
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

const KIT_MODULES = ["avatar", "greeting", "popover"];

function widget(): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <AccountMenuWidget config={CONFIG} lang="pl" />
    </QueryClientProvider>
  );
}

/** Mikrozadania i jedno makrozadanie: dynamiczny import zdążyłby ruszyć. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AccountMenuWidget - gość statycznie, panel na intencję (P2.3)", () => {
  it("HTML serwera gościa = dotychczasowy wyzwalacz Radixa, bez importu zestawu", async () => {
    const html = renderToString(widget());
    // Wzorzec: dawny znacznik (`PopoverTrigger asChild` z tym samym przyciskiem).
    const { Popover, PopoverTrigger } =
      await vi.importActual<typeof import("@/components/ui/popover")>("@/components/ui/popover");
    const legacy: ReactElement = (
      <div className="relative inline-flex items-center gap-x-2 sm:gap-x-3 overflow-visible">
        <Popover open={false}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-2 text-[11px] font-medium leading-none whitespace-nowrap hover:opacity-80 cursor-pointer"
              aria-label="Zaloguj / Załóż konto"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Zaloguj</span>
              <span className="text-muted-foreground/40" aria-hidden>
                |
              </span>
              <span style={{ color: "var(--widget-orange-accent)" }}>Załóż konto</span>
            </button>
          </PopoverTrigger>
        </Popover>
      </div>
    );
    expect(html).toBe(renderToString(legacy));
    expect(html).toContain('aria-haspopup="dialog" aria-expanded="false" data-state="closed"');
    // `importActual` omija atrapę, więc lista mówi wyłącznie o widgecie.
    expect(kit.imported).toEqual([]);
  });

  it("hydratacja gościa nie importuje zestawu; najechanie go rozgrzewa", async () => {
    const element = widget();
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);
    const serverButton = container.querySelector("button");
    if (!serverButton) throw new Error("brak przycisku gościa w HTML serwera");
    const errors: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: (e) => errors.push(e) });
    });
    await settle();
    expect(errors).toEqual([]);
    expect(container.querySelector("button")).toBe(serverButton);
    expect(kit.imported).toEqual([]);

    fireEvent.pointerEnter(serverButton);
    await waitFor(() => expect([...kit.imported].sort()).toEqual(KIT_MODULES));
    // Zestaw rozstrzygnięty (te same instancje modułów): kolejny przypadek
    // otwiera menu z gotowego zestawu.
    await act(async () => {
      await Promise.all([
        import("@/components/ui/popover"),
        import("@/components/ui/avatar"),
        import("@/lib/greetings/useGreeting"),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => root.unmount());
  });

  it("kliknięcie gościa otwiera menu z pozycjami sekcji guest", async () => {
    render(widget());
    fireEvent.click(screen.getByRole("button", { name: "Zaloguj / Załóż konto" }));
    const item = await screen.findByText("Cennik");
    expect(item.closest("a")).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("button", { name: "Zaloguj / Załóż konto" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Zestaw zaimportowany raz na dokument.
    expect([...kit.imported].sort()).toEqual(KIT_MODULES);
  });
});
