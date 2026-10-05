// AccountMenuWidget przy zapisanej sesji (P2.3, krytyka planu M12): zestaw
// panelu (Popover i Avatar Radixa, silnik powitań) rusza przy montażu, bez
// interakcji - zalogowany widzi awatar zaraz po `getSession()`, jak przed
// podziałem. Osobny plik, bo zestaw jest stanem modułu (jeden import na
// dokument), a przypadki gościa w `accountMenuWidget.intent.test.tsx` muszą
// zacząć od modułu bez importu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountMenuWidget } from "../AccountMenuWidget";

const kit = vi.hoisted(() => ({ imported: [] as string[] }));
const hint = vi.hoisted(() => ({ stored: true }));

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
  hasStoredAuthSession: () => hint.stored,
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
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pl" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(() => {
  cleanup();
});

describe("AccountMenuWidget - zapisana sesja (P2.3)", () => {
  it("zestaw panelu rusza przy montażu, zanim sesja się rozstrzygnie", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountMenuWidget config={{}} lang="pl" />
      </QueryClientProvider>,
    );
    // Do rozstrzygnięcia sesji stoi przycisk gościa (jak w HTML serwera).
    expect(screen.getByRole("button", { name: "Zaloguj / Zarejestruj" })).toBeInTheDocument();
    await waitFor(() =>
      expect([...kit.imported].sort()).toEqual(["avatar", "greeting", "popover"]),
    );
  });
});
