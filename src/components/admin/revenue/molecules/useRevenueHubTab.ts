// Bramka odnośników „moduł → hub" (SPEC §2.7, montaż I9): czy ta sesja może
// przejść z ekranu modułu do danej zakładki huba „Przychód i lejek".
//
// ROLA PRZED ODNOŚNIKIEM. Studio wydarzeń, kluby i automatyzacje otwierają
// także role spoza huba; odnośnik do zakładki, której rola nie widzi, kończy
// się odmową w hubie - więc dla takiej roli nie ma go wcale. `canSeeTab` to
// TA SAMA reguła co pasek zakładek i ⌘K (`hubTabs.ts` jedzie już w powłoce
// panelu - zero dodatkowego kodu w chunku modułu).
//
// `useHydrated()` PRZED SESJĄ (jak `RevenueSignalChip`): serwer nie zna sesji
// tak jak klient, więc do hydratacji odnośnika nie ma, a znacznik serwera
// zgadza się z pierwszym renderem klienta. Bez najemcy hub nic nie pokaże -
// odnośnik też nie.
import { useHydrated } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import { canSeeTab } from "@/lib/admin/revenue/hubTabs";
import type { RevenueTabId } from "@/lib/revenue/search";

export function useRevenueHubTab(tab: RevenueTabId): boolean {
  const hydrated = useHydrated();
  const { roles, tenantId } = useAuth();
  return hydrated && Boolean(tenantId) && canSeeTab(tab, roles);
}
