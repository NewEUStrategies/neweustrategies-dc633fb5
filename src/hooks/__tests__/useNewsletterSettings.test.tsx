// Ustawienia newslettera: pełny klucz (popup, panel) i projekcja formularzy
// inline (P2.5) czytają TEN SAM wiersz `newsletter_settings` tym samym URL-em.
//
// CO TEN PLIK DOWODZI (P3.8, poprawka #7). Gdy oba wpisy odświeżały się naraz
// (np. popup montowany przy zatrzasku interakcji/ciszy, a formularz inline
// w wyspie z nieświeżym wpisem), szły dwa identyczne GET-y z preflightami:
//   - w przeglądarce równoległe odczyty dzielą JEDEN lot;
//   - dedup dotyczy wyłącznie lotu: kolejne odświeżenie idzie do sieci.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const stubs = vi.hoisted(() => ({ from: null as unknown }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

// Ciało odczytu jedzie w leniwym `newsletterSettingsData.ts` (P3.8, zamknięcie
// bootu), więc fabryki zapytań nie importują klienta statycznie - atrapę
// uruchamiamy jawnie, zanim `beforeEach` sięgnie po jej rejestr.
import "@/integrations/supabase/client";
import {
  newsletterInlineSettingsQueryOptions,
  newsletterSettingsQueryOptions,
} from "@/hooks/useNewsletterSettings";
import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { newsletterKeys } from "@/lib/newsletter/keys";
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

// ---------------------------------------------------------------------------
// S1 (def. 9, D-S1-03/04): klucze z fabryki szyny, token zapisu w wierszu
// i szew zgodności zapisu bez statycznej krawędzi do modułu panelu.
// ---------------------------------------------------------------------------
describe("useNewsletterSettings: klucze, token i szew zapisu (S1)", () => {
  it("pełny klucz i projekcja inline pochodzą z `newsletterKeys` (reguła szyny trafia prefiksem)", () => {
    expect(newsletterSettingsQueryOptions().queryKey).toEqual(newsletterKeys.settings());
    expect(newsletterInlineSettingsQueryOptions().queryKey).toEqual(
      newsletterKeys.settingsInline(),
    );
  });

  it("wiersz niesie SUROWY `updated_at` (token zapisu grup), a brak wiersza - żadnego tokenu", async () => {
    const token = "2026-10-19T10:00:00.123456+00:00";
    from().setResponse("newsletter_settings", ok({ ...ROW, updated_at: token }));
    const full = await client.fetchQuery(newsletterSettingsQueryOptions());
    expect(full.updated_at).toBe(token);

    from().setResponse("newsletter_settings", ok(null));
    const empty = await client.fetchQuery({ ...newsletterSettingsQueryOptions(), staleTime: 0 });
    expect(empty.updated_at).toBeUndefined();
  });

  it("moduł chunku wejściowego nie sięga do modułu grup ani panelu - także dynamicznie", () => {
    // Nawet `import()` z tego pliku liczy moduł grup, `planQueries.ts`
    // i fabryki kluczy huba do paczki PUBLICZNEJ (budżet `public`, SPEC §8.6),
    // choć zapis istnieje wyłącznie w panelu - szew `useSaveNewsletterSettings`
    // mieszka więc w `lib/newsletter/settingsQueries.ts` (test szwu tam).
    const kod = bezKomentarzy(readFileSync("src/hooks/useNewsletterSettings.ts", "utf8"));
    const statyczne = [...kod.matchAll(/^import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    const dynamiczne = [...kod.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
    expect(
      [...statyczne, ...dynamiczne].filter((p) => /settingsQueries|admin|planQueries/.test(p)),
    ).toEqual([]);
    expect(kod).not.toMatch(/useSaveNewsletterSettings|useMutation/);
  });
});
