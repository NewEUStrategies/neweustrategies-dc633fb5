// `/auth/callback` w lejku czytelnika (S3, P15): link aktywacyjny z
// rejestracji przez paywall/klub/kasę niesie `?next` - nowe konto wraca na
// treść; cel spoza serwisu albo pętla logowania spada na stronę powitalną.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ i18n: { language: "pl" }, t: (k: string) => k }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: h.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { Route } from "@/routes/auth.callback";

const WELCOME = { to: "/welcome", search: { mode: undefined }, replace: true };

async function mount(url: string) {
  window.history.replaceState({}, "", url);
  const Page = Route.options.component;
  if (!Page) throw new Error("test: trasa bez komponentu");
  render(<Page />);
  await act(() => vi.advanceTimersByTimeAsync(300));
}

beforeEach(() => {
  vi.useFakeTimers();
  h.navigate.mockReset();
  h.getSession
    .mockReset()
    .mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("/auth/callback - powrót na treść", () => {
  it("bezpieczny next: wraca na artykuł (z zapytaniem)", async () => {
    await mount(`/auth/callback?next=${encodeURIComponent("/analizy/x?ref=nl")}`);
    expect(h.navigate).toHaveBeenCalledWith({ href: "/analizy/x?ref=nl", replace: true });
  });

  it.each(["//evil.com", "https://evil.com", "/%2F%2Fevil.com", "/login"])(
    "niebezpieczny next (%s): strona powitalna",
    async (next) => {
      await mount(`/auth/callback?next=${encodeURIComponent(next)}`);
      expect(h.navigate).toHaveBeenCalledWith(WELCOME);
    },
  );

  it("bez next: strona powitalna, jak dotąd", async () => {
    await mount("/auth/callback");
    expect(h.navigate).toHaveBeenCalledWith(WELCOME);
  });
});
