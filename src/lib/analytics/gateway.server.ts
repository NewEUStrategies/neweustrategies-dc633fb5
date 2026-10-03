/**
 * Wspólna bramka serwerowych funkcji analityki: kontrakt kontekstu Supabase,
 * bramka roli admina i odczyt ustawień analityki z `site_settings`.
 *
 * Wydzielone, bo każda serwerowa funkcja analityki potrzebuje tej samej
 * bramki. Wcześniej kopia `requireAdmin` żyła w kilku plikach, więc
 * utwardzenie bramki w jednym miejscu nie propagowało się na pozostałe.
 * Użytkownicy `requireAnalyticsAdmin` (każdy woła ją PRZED pierwszym odczytem
 * danych, także przed ustaleniem najemcy):
 *
 *   - `ga4.functions.ts` - raport Data API i Measurement Protocol,
 *   - `gsc.functions.ts` - lista właściwości, kwerenda, inspekcja adresu,
 *   - `status.functions.ts` - stan integracji panelu /admin/analytics,
 *   - `semantic/snapshot.functions.ts` - migawka warstwy semantycznej,
 *   - `audience.functions.ts` - segmenty audytorium,
 *   - `@/lib/observability/vitals.functions.ts` - RUM (Core Web Vitals),
 *   - `@/lib/observability/clientErrors.functions.ts` - błędy przeglądarki,
 *   - `@/lib/relatedInsights.functions.ts` - analityka rekomendacji.
 *
 * `readStoredAnalyticsSettings` (przez `toAnalyticsGatewayCtx`) czytają GA4,
 * status i warstwa semantyczna.
 *
 * Bramka jest TENANT-SCOPED: `has_role()` filtruje `user_roles` po
 * `current_tenant_id()`, więc stara rola z innego najemcy nigdy nie autoryzuje
 * odczytu danych tego najemcy.
 *
 * DLACZEGO NIE `requireAdmin` Z `require-staff.ts`. To inna polityka, a nie
 * inna implementacja tej samej: wpuszcza też `super_admin` (tu `has_role(…,
 * 'admin')` dopasowuje rolę dokładnie), wymusza MFA step-up na sesji aal1
 * (admin z zapisanym drugim składnikiem traciłby panel do ponownej
 * weryfikacji), czyta `profiles`/`user_roles` przez `from()` zamiast RPC
 * i rzuca „Forbidden: could not verify …" zamiast surowego komunikatu bazy.
 * Podmiana zmieniłaby, KTO widzi analitykę - to decyzja produktowa, a nie
 * refaktor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Odpowiedź PostgREST w zakresie, z którego ten moduł korzysta: `data` jako
 * `unknown` (każdy odczyt i tak zawęża ją jawnie) i sam tekst błędu.
 */
type GatewayResponse = { data: unknown; error: { message: string } | null };

/**
 * Minimalny kontrakt bramki roli: JEDNO wywołanie RPC na kliencie wołającego.
 *
 * Typ jest celowo wąski, a nie „dowolne rpc" - dzięki temu prawdziwy
 * `SupabaseClient<Database>` z `requireSupabaseAuth` pasuje do niego WPROST,
 * bez rzutowania przez `unknown`, czyli bez wyłączania kontroli typów na
 * granicy autoryzacji. Trzy szczegóły, od których to zależy:
 *
 *   - nazwa i argumenty jako LITERAŁY: generyczne `rpc` klienta wyprowadza
 *     z nich `has_role` i jego `Args` z wygenerowanych typów, a ogólne
 *     `string` nie zmieściłoby się w unii nazw funkcji schematu,
 *   - argumenty jako literał typu, nie `interface`: literał ma niejawną
 *     sygnaturę indeksu, więc atrapy testów z `Record<string, unknown>` dalej
 *     się tu przypisują,
 *   - `PromiseLike`, nie `Promise`: builder PostgREST implementuje wyłącznie
 *     `then` (bez `catch`/`finally`), a `await` więcej nie potrzebuje.
 *
 * Wołający przekazuje cały kontekst (`requireAnalyticsAdmin(context)`), nigdy
 * wyjętą metodę `rpc` - ta potrzebuje `this === supabase`.
 */
export type AnalyticsAdminGateCtx = {
  supabase: {
    rpc(fn: "has_role", args: { _user_id: string; _role: "admin" }): PromiseLike<GatewayResponse>;
  };
  userId: string;
};

/**
 * Kontrakt kontekstu dla odczytu ustawień: bramka plus łańcuch
 * `from("site_settings").select("value").eq("key", …)` - dokładnie te
 * wywołania, które modelują atrapy testów (szersze `string` w parametrach
 * atrap dalej się tu przypisują).
 *
 * Prawdziwego klienta NIE da się tu przypisać wprost, choć w runtime pasuje:
 * porównanie generycznego `eq` PostgREST (typy warunkowe filtra po kolumnie)
 * z tą sygnaturą kończy się w `tsc` błędem TS2589 („excessively deep"). Zamiast
 * rzutowania przez `unknown` w każdym wołającym jest `toAnalyticsGatewayCtx`
 * niżej - adapter, w którym każde wywołanie klienta jest typowane.
 */
export type AnalyticsGatewayCtx = AnalyticsAdminGateCtx & {
  supabase: {
    from(table: "site_settings"): {
      select(columns: "value"): {
        eq(column: "key", value: string): PromiseLike<GatewayResponse>;
      };
    };
  };
};

/**
 * Kontekst `requireSupabaseAuth` jako `AnalyticsGatewayCtx`, bez rzutowania.
 *
 * Adapter tylko PRZEKAZUJE wywołania - ten sam klient (JWT wołającego, więc
 * RLS i `current_tenant_id()` najemcy wołającego), te same argumenty, metody
 * wołane na kliencie i builderze (żadnej wyjętej metody bez `this`). Literały
 * w kontrakcie sprawiają, że `tsc` sprawdza tu nazwę RPC, jej argumenty
 * i kolumnę filtra względem wygenerowanych typów bazy.
 */
export function toAnalyticsGatewayCtx(context: {
  supabase: SupabaseClient<Database>;
  userId: string;
}): AnalyticsGatewayCtx {
  const client = context.supabase;
  return {
    userId: context.userId,
    supabase: {
      rpc: (fn, args) => client.rpc(fn, args),
      from: (table) => ({
        select: (columns) => ({
          eq: (column, value) => client.from(table).select(columns).eq(column, value),
        }),
      }),
    },
  };
}

/** Bramka: wywołujący musi być adminem SWOJEGO najemcy. Rzuca w innym wypadku. */
export async function requireAnalyticsAdmin(context: AnalyticsAdminGateCtx): Promise<void> {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden: admin role required");
}

/** Ustawienia analityki zapisane w `site_settings` pod kluczem `analytics`. */
export interface StoredAnalyticsSettings {
  ga4_enabled?: boolean;
  ga4_property_id?: string;
  ga4_measurement_id?: string;
}

/**
 * Odczyt ustawień analityki. Degraduje do pustego obiektu przy każdym błędzie:
 * brak ustawień oznacza „nieskonfigurowane”, a nie awarię dashboardu.
 */
export async function readStoredAnalyticsSettings(
  ctx: AnalyticsGatewayCtx,
): Promise<StoredAnalyticsSettings> {
  try {
    const res = await ctx.supabase.from("site_settings").select("value").eq("key", "analytics");
    if (res.error) return {};
    const rows = (res.data ?? []) as Array<{ value: StoredAnalyticsSettings | null }>;
    return rows[0]?.value ?? {};
  } catch {
    return {};
  }
}
