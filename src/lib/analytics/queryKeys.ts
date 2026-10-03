// KLUCZE ZAPYTAŃ PANELU ANALITYKI - wydzielone z komponentów, żeby dały się
// sprawdzić testem (wzór: `src/lib/admin/dashboard/queryKeys.ts`).
//
// INWARIANT: KLUCZ ZAWIERA TENANTA. Dane są zawsze poprawne - funkcje serwera
// biorą najemcę z profilu wołającego (`has_role()` / `current_tenant_id()`,
// `resolveUserTenantId`), nigdy z klucza - ale klucz decyduje o tym, CO POKAŻE
// CACHE. Bez tenanta w kluczu wejście na panel po przełączeniu obszaru
// roboczego wyrysowałoby stan integracji, próbki RUM albo liczby kuponów
// POPRZEDNIEGO najemcy - z właściwą etykietą i całkowicie cudze - aż do
// pierwszego odświeżenia w tle. Do 2026-10 dokładnie tak było: pasek BI,
// mini-panel RUM, trzy odczyty statusu i analityka kuponów miały klucze bez
// najemcy, choć pełne dashboardy (`VitalsBiDashboard` i reszta) trzymały go
// w kluczu od dawna.
//
// KSZTAŁT: `["admin-analytics", tenantId, …]`. Tenant stoi na indeksie 1, więc
// jeden prefiks obejmuje jednego najemcę, a korzeń - całą analitykę. Wołający
// przekazuje `tenantId ?? ""` i trzyma zapytanie na `enabled: Boolean(tenantId)`:
// pusty tenant to klucz-zaślepka, pod który NIC nie ma prawa się pobrać.
// Uwaga na dwie pułapki zapytania wyłączonego: `isLoading` jest wtedy `false`
// (stan „ładuję" to `!tenantId || q.isLoading`), a `refetch()` ignoruje
// `enabled` (przycisk odświeżenia musi być wyłączony, dopóki tenanta nie ma).
//
// UNIEWAŻNIANIE PO KORZENIU (`analyticsRootKey()`), nie po pojedynczym kluczu:
// zapis ustawień analityki zmienia odpowiedź statusu, a korzeń trafia w nią
// niezależnie od tego, pod którym najemcą i z którego ekranu ją zapamiętano.
// Wyjątek to dziedzina, którą zmienia ZAPIS POZA analityką - kupony: mutacja
// kuponu unieważnia prefiks analityki kuponów SWOJEGO najemcy
// (`analyticsCouponsPrefixKey`), bo funkcja agregująca liczy po wszystkich
// kuponach najemcy (LEFT JOIN), więc nowy, skasowany albo wygenerowany kod
// zmienia ranking od razu, a nie dopiero po `staleTime`.

/** Korzeń wszystkich kluczy panelu analityki - do unieważniania hurtem. */
export function analyticsRootKey(): readonly unknown[] {
  return ["admin-analytics"];
}

/** Prefiks jednego najemcy. */
export function analyticsTenantKey(tenantId: string): readonly unknown[] {
  return [...analyticsRootKey(), tenantId];
}

/**
 * Stan integracji (`getAnalyticsStatus`). JEDEN klucz dla trzech ekranów
 * (/admin/analytics, /admin/analytics/bi, /admin/settings/analytics) - wspólny
 * wpis cache'u sprawia, że po zapisie ustawień wszystkie trzy mówią to samo.
 */
export function analyticsStatusKey(tenantId: string): readonly unknown[] {
  return [...analyticsTenantKey(tenantId), "status"];
}

/** Mini-panel RUM na /admin/analytics; `days` w kluczu, bo to parametr odczytu. */
export function analyticsVitalsMiniKey(tenantId: string, days: number): readonly unknown[] {
  return [...analyticsTenantKey(tenantId), "vitals-mini", days];
}

/** Źródło paska BI (`AdminBiStrip`) - RUM i błędy przeglądarki są niezależne. */
export type BiStripSource = "vitals" | "errors";

/** Jedno źródło paska BI w oknie `days`. */
export function analyticsBiStripKey(
  tenantId: string,
  source: BiStripSource,
  days: number,
): readonly unknown[] {
  return [...analyticsTenantKey(tenantId), "bi-strip", source, days];
}

/**
 * Prefiks analityki kuponów B2B jednego najemcy - wszystkie zakresy dat naraz.
 * Do unieważniania po mutacji kuponu (`invalidateCouponQueries`): zakres
 * zapamiętany na /admin/coupons/analytics jest dowolny, więc mutacja nie zna
 * pełnego klucza, a prefiks trafia w każdy.
 */
export function analyticsCouponsPrefixKey(tenantId: string): readonly unknown[] {
  return [...analyticsTenantKey(tenantId), "b2b-coupons"];
}

/**
 * Analityka kuponów B2B (`b2b_coupons_analytics`). Granice jako ISO albo `null`
 * (brak granicy) - dwa zakresy różniące się tylko końcem to dwa różne odczyty.
 */
export function analyticsCouponsKey(
  tenantId: string,
  fromIso: string | null,
  toIso: string | null,
): readonly unknown[] {
  return [...analyticsCouponsPrefixKey(tenantId), fromIso, toIso];
}
