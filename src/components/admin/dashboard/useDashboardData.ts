// ODCZYTY PULPITU - jeden hook na sekcję, wszystkie na jednym oknie.
//
// SZEŚĆ ZAPYTAŃ, NIE JEDNO. Kuszące byłoby zebrać cały pulpit w jedno wywołanie,
// ale wtedy najwolniejsza sekcja (lejek CRM po całej tabeli) wstrzymywałaby
// najszybszą (podgląd na żywo po indeksie czasowym), a awaria jednej gasiłaby
// wszystkie. Osobne zapytania rysują się niezależnie i niezależnie się psują.
//
// PODGLĄD NA ŻYWO CHODZI WŁASNYM RYTMEM i nie zależy od zakładki okresu: liczba
// "teraz na stronie" ma sens także wtedy, gdy patrzy się na rok.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";

import {
  REALTIME_ACTIVE_MINUTES,
  REALTIME_WINDOW_MINUTES,
  quantizeNow,
  rangeQuantumMs,
  resolveDashboardRange,
  type DashboardPeriodId,
  type DashboardRange,
} from "@/lib/admin/dashboard/period";
import {
  getDashboardAudience,
  getDashboardContent,
  getDashboardCrm,
  getDashboardMarketing,
  getDashboardRealtime,
  getDashboardTraffic,
} from "@/lib/admin/dashboard/dashboard.functions";
import { chartLangFrom } from "@/lib/charts/format";
import { useRequiredTenant } from "@/hooks/useAuth";
import { dashboardQueryKey, realtimeQueryKey } from "@/lib/admin/dashboard/queryKeys";

/**
 * Okno bieżące dla zakładki, odświeżane w rytmie jej kwantu.
 *
 * Zegar czytamy w efekcie, a nie przy renderze - render ma być czysty, a poza
 * tym pierwsze wyliczenie musi trafić w ten sam kwant, co kolejne, żeby klucz
 * zapytania nie zmienił się zaraz po zamontowaniu.
 */
export function useDashboardRange(period: DashboardPeriodId): DashboardRange {
  const [nowMs, setNowMs] = useState(() => quantizeNow(period, Date.now()));

  useEffect(() => {
    setNowMs(quantizeNow(period, Date.now()));
    const id = setInterval(() => setNowMs(quantizeNow(period, Date.now())), rangeQuantumMs(period));
    return () => clearInterval(id);
  }, [period]);

  return useMemo(() => resolveDashboardRange(period, nowMs), [period, nowMs]);
}

/** Ładunek wspólny dla pięciu funkcji serwerowych. */
function windowPayload(range: DashboardRange) {
  return {
    sinceIso: range.current.sinceIso,
    untilIso: range.current.untilIso,
    prevSinceIso: range.previous.sinceIso,
    prevUntilIso: range.previous.untilIso,
    bucket: range.bucket,
    offsetMinutes: range.offsetMinutes,
  };
}

// Okno już minione nie zmieni się nigdy, więc jego odczyt może leżeć w cache
// dowolnie długo; okno rosnące trzeba odświeżać. `complete` mówi, które to które.
const staleFor = (range: DashboardRange) => (range.complete ? 30 * 60_000 : 60_000);

export function useTrafficQuery(range: DashboardRange) {
  const fetch = useServerFn(getDashboardTraffic);
  const tenantId = useRequiredTenant();
  return useQuery({
    queryKey: dashboardQueryKey(tenantId, "traffic", range),
    queryFn: () => fetch({ data: windowPayload(range) }),
    staleTime: staleFor(range),
  });
}

export function useCrmQuery(range: DashboardRange) {
  const fetch = useServerFn(getDashboardCrm);
  const tenantId = useRequiredTenant();
  return useQuery({
    queryKey: dashboardQueryKey(tenantId, "crm", range),
    queryFn: () => fetch({ data: windowPayload(range) }),
    staleTime: staleFor(range),
  });
}

export function useMarketingQuery(range: DashboardRange) {
  const fetch = useServerFn(getDashboardMarketing);
  const tenantId = useRequiredTenant();
  return useQuery({
    queryKey: dashboardQueryKey(tenantId, "marketing", range),
    queryFn: () => fetch({ data: windowPayload(range) }),
    staleTime: staleFor(range),
  });
}

export function useAudienceQuery(range: DashboardRange) {
  const fetch = useServerFn(getDashboardAudience);
  const tenantId = useRequiredTenant();
  return useQuery({
    queryKey: dashboardQueryKey(tenantId, "audience", range),
    queryFn: () => fetch({ data: windowPayload(range) }),
    staleTime: staleFor(range),
  });
}

export function useContentQuery(range: DashboardRange) {
  const fetch = useServerFn(getDashboardContent);
  const tenantId = useRequiredTenant();
  const { i18n } = useTranslation();
  // Tytuły wpisów wracają w języku panelu, więc język JEST częścią klucza -
  // bez niego przełączenie PL/EN pokazywałoby czołówkę z poprzedniego języka.
  const lang = chartLangFrom(i18n.language);
  return useQuery({
    queryKey: dashboardQueryKey(tenantId, "content", range, [lang]),
    queryFn: () => fetch({ data: { ...windowPayload(range), lang } }),
    staleTime: staleFor(range),
  });
}

/**
 * Puls na żywo. Odpytywany w stałym rytmie NIEZALEŻNIE od zakładki okresu -
 * i tylko wtedy, gdy karta jest widoczna: `refetchIntervalInBackground` zostaje
 * wyłączone, żeby pulpit zostawiony na drugim monitorze nie odpytywał bazy
 * przez całą noc.
 */
export function useRealtimeQuery() {
  const fetch = useServerFn(getDashboardRealtime);
  const tenantId = useRequiredTenant();
  return useQuery({
    queryKey: realtimeQueryKey(tenantId, REALTIME_ACTIVE_MINUTES, REALTIME_WINDOW_MINUTES),
    queryFn: () =>
      fetch({
        data: {
          activeMinutes: REALTIME_ACTIVE_MINUTES,
          windowMinutes: REALTIME_WINDOW_MINUTES,
        },
      }),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}
