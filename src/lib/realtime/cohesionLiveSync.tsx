// Globalny mostek warstwy spójności - montowany raz w __root (obok
// WidgetLiveSync / SiteSettingsLiveSync), LENIWIE I DOPIERO PO ROZSTRZYGNIĘCIU
// SESJI. Wyłącznie dla ZALOGOWANYCH: anonimowi odwiedzający nie mogą trzymać
// websocketów Realtime (kwoty połączeń - ta sama doktryna co
// siteSettingsLiveSync).
//
//   * useDomainEventInvalidation - jeden kanał domain_events; mapa
//     eventInvalidationMap odświeża cache modułów, a strumień przy okazji
//     zasila tracker korelacji (potwierdzenia optymistycznych mutacji);
//   * usePendingCountersRealtime - badge'e liczników na żywo.
//
// Oba haki same wychodzą na `if (!uid) return`, więc dla anonima ten komponent
// był czystym no-opem - a statyczny import ciągnął mimo to do chunku
// wejściowego `eventInvalidationMap` (~15 kB źródeł), strumień zdarzeń domeny
// i liczniki, czyli kod, którego anonimowy czytelnik nigdy nie wykona
// (audyt CWV 2026-09-20, F23).
import { useDomainEventInvalidation } from "./useModuleRealtime";
import { usePendingCountersRealtime } from "@/lib/counters/usePendingCounters";

export function CohesionLiveSync() {
  useDomainEventInvalidation();
  usePendingCountersRealtime();
  return null;
}
