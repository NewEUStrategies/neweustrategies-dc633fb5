// Publiczne pytanie „czy ten slug należy do osoby bez roli autora" - służy
// wyłącznie do 301 z /author/<slug> na /people/<slug>.
//
// BRAK WERDYKTU TO WYJĄTEK, NIE `false`. `false` znaczy „zostań na /author"
// i trasa oddaje wtedy hub z WSPÓLNYM `Cache-Control`. supabase-js nie rzuca
// na awarii (sieć, 5xx, PGRST202 - brak funkcji, statement timeout): zwraca
// `{ error }`. Zamiana tego na `false` robiła z każdej awarii werdykt
// „autor", więc hub osoby bez roli autora wychodził z brzegu bez 301. Rzut
// trafia w `.then(..., noop)` loadera (src/routes/author.$slug.tsx) jako
// `verdict === null`, a to daje hub albo 404 z `no-store`. Ta sama reguła
// dotyczy braku konfiguracji - bez klienta nie ma odpowiedzi.
//
// TOŻSAMOŚĆ CZYTELNIKA JEDZIE DO RPC, GDY JEST. Od migracji 0053 werdykt
// zależy od WOŁAJĄCEGO: gość dostaje `true` tylko dla profilu, który widzi
// w `profiles_public` (źródło huba), a zalogowany - tylko gdy cel 301
// (`get_member_profile`, karta /people) rozwiąże dla niego profil. Hub przy
// nawigacji SPA czyta przeglądarkowy klient Z SESJĄ, więc werdykt musi dostać
// tę samą tożsamość: globalny `attachSupabaseAuth` dokleja bearer do żądania
// server fn, a tu przekazujemy go dalej do PostgREST (który sam weryfikuje
// podpis - podróbka daje błąd, czyli brak werdyktu, nigdy cudzą warstwę). Bez
// tego zalogowany czytelnik widział hub osoby bez roli autora, której profil
// otworzy na /people (warstwa członkowska), a werdykt anonima mówił `false` -
// trasa oddawała /author zamiast 301 na /people. SSR nie ma sesji (żądanie
// dokumentu nie niesie `Authorization`), więc tam werdykt i hub zostają oba
// anonimowe.
//
// WERDYKT Z TOŻSAMOŚCIĄ JEST PER UŻYTKOWNIK, więc odpowiedź dostaje
// `private, no-store` - ani odpowiedź GET tej server fn, ani dokument, którego
// render ją policzył (żądanie z `Authorization` w SSR), ani wynikające z niej
// 301 nie mogą trafić do współdzielonego cache'a. Werdykt anonimowy nie
// rusza nagłówka: w SSR ta funkcja biegnie W PROCESIE żądania dokumentu i
// `no-store` odebrałby brzegowi każdy hub autora.
//
// Tenant: `fetchWithTenantHost` (jak w pozostałych publicznych server fn) -
// werdykt dotyczy tego samego tenanta, dla którego trasa czyta hub.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split); moduły serwerowe ładuje handler dynamicznie.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { cacheControlHeader } from "@/lib/http/cachePolicy";

export const isNonAuthorMemberSlug = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ slug: z.string().min(1).max(200) }).parse(data))
  .handler(async ({ data }): Promise<boolean> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) throw new Error("member_slug_is_non_author: brak konfiguracji Supabase");
    const [{ optionalBearerFromRequest }, { setCacheControlHeader }] = await Promise.all([
      import("@/lib/auth/optionalUser.server"),
      import("@/lib/http/responseHeaders"),
    ]);
    const bearer = await optionalBearerFromRequest();
    // PRZED zapytaniem: w SSR loader czeka na werdykt najwyżej do terminu
    // żądania, więc opt-out ustawiony dopiero po odpowiedzi RPC mógłby
    // spóźnić się na nagłówki dokumentu.
    if (bearer) setCacheControlHeader(cacheControlHeader({ cacheable: false }));
    const client = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: bearer
        ? { fetch: fetchWithTenantHost, headers: { Authorization: `Bearer ${bearer}` } }
        : { fetch: fetchWithTenantHost },
    });
    const { data: result, error } = await client.rpc("member_slug_is_non_author", {
      p_slug: data.slug,
    });
    if (error) throw new Error(error.message);
    return result === true;
  });
