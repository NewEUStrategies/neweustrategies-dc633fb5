/**
 * Wspólna bramka serwerowych funkcji analityki: kontrakt kontekstu Supabase,
 * bramka roli admina i odczyt ustawień analityki z `site_settings`.
 *
 * Wydzielone, bo każda serwerowa funkcja analityki (GA4, GSC, status, warstwa
 * semantyczna) potrzebuje dokładnie tych trzech rzeczy. Wcześniej kopia
 * `requireAdmin` żyła w kilku plikach, więc utwardzenie bramki w jednym miejscu
 * nie propagowało się na pozostałe.
 *
 * Bramka jest TENANT-SCOPED: `has_role()` filtruje `user_roles` po
 * `current_tenant_id()`, więc stara rola z innego najemcy nigdy nie autoryzuje
 * odczytu danych tego najemcy.
 */

/**
 * Minimalny kontrakt na kontekst wstrzykiwany przez `requireSupabaseAuth`.
 * Świadomie węższy niż pełny klient Supabase - serwerowe funkcje analityki
 * używają wyłącznie tych dwóch operacji, a węższy typ nie wymaga rzutowań.
 */
export interface AnalyticsGatewayCtx {
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
}

/** Bramka: wywołujący musi być adminem SWOJEGO najemcy. Rzuca w innym wypadku. */
export async function requireAnalyticsAdmin(context: AnalyticsGatewayCtx): Promise<void> {
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
