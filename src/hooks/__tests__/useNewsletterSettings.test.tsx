// Ustawienia newslettera: pełny klucz (popup, panel) i projekcja formularzy
// inline (P2.5) czytają TEN SAM wiersz `newsletter_settings` tym samym URL-em.
//
// CO TEN PLIK DOWODZI (P3.8, poprawka #7). Gdy oba wpisy odświeżały się naraz
// (np. popup montowany przy zatrzasku interakcji/ciszy, a formularz inline
// w wyspie z nieświeżym wpisem), szły dwa identyczne GET-y z preflightami:
//   - w przeglądarce równoległe odczyty dzielą JEDEN lot;
//   - dedup dotyczy wyłącznie lotu: kolejne odświeżenie idzie do sieci.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const stubs = vi.hoisted(() => ({ from: null as unknown }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import {
  newsletterInlineSettingsQueryOptions,
  newsletterSettingsQueryOptions,
} from "@/hooks/useNewsletterSettings";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";

const from = () => stubs.from as SupabaseFromStub;
const gets = () => from().chainsFor("newsletter_settings").length;
const ROW = { enabled: true, heading_pl: "Bądź na bieżąco", popup_enabled: true };

let client: QueryClient;
beforeEach(() => {
  from().reset();
  from().setResponse("newsletter_settings", ok(ROW));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("useNewsletterSettings: jeden wiersz, jeden lot (P3.8 #7)", () => {
  it("równoległy odczyt pełnego klucza i projekcji inline to JEDEN GET", async () => {
    const [full, inline] = await Promise.all([
      client.fetchQuery(newsletterSettingsQueryOptions()),
      client.fetchQuery(newsletterInlineSettingsQueryOptions()),
    ]);

    expect(gets()).toBe(1);
    expect(full.heading_pl).toBe("Bądź na bieżąco");
    expect(inline.heading_pl).toBe("Bądź na bieżąco");
  });

  it("dedup obejmuje wyłącznie lot - kolejne odświeżenie idzie do sieci", async () => {
    await client.fetchQuery(newsletterSettingsQueryOptions());
    await client.fetchQuery({ ...newsletterSettingsQueryOptions(), staleTime: 0 });

    expect(gets()).toBe(2);
  });
});
