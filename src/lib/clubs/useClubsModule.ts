// Przełącznik modułu klubów - JEDEN punkt odczytu dla wszystkich tras.
//
// BŁĄD, KTÓRY TO NAPRAWIA. `community_modules.clubs_enabled` istniał od A1
// z komentarzem obiecującym, że "wyłączenie chowa moduł z nawigacji bez
// rebuildu, jak każdy inny moduł". Nie miał ANI JEDNEGO konsumenta poza
// przełącznikiem w panelu: administrator klikał "wyłącz", zapis się udawał,
// panel pokazywał stan wyłączony - a `/club` działało dalej dokładnie tak samo.
// To gorzej niż brak przełącznika, bo przełącznik bez skutku jest deklaracją,
// że coś zostało wyłączone.
//
// Dlaczego osobny moduł, a nie `useCommunityModules()` wołane w każdej trasie:
// wyłączenie modułu musi jednocześnie ZGASIĆ ZAPYTANIA. Trasa, która renderuje
// ekran "moduł wyłączony", ale nadal woła `club_list`, wysyła ruch do bazy za
// funkcję, której nikt nie zobaczy - i przy okazji zapala liczniki w logach RPC.
// Stąd para `enabled` + `disabled`: pierwsza jedzie do `useQuery({ enabled })`,
// druga do wczesnego `return`.
//
// Bramka jest UI-owa, nie bezpieczeństwem. Dostępu pilnują RLS i SECURITY
// DEFINER RPC; ten przełącznik decyduje, czy tenant W OGÓLE prowadzi kluby.
import { useCommunityModules } from "@/lib/community/useCommunityModules";

export interface ClubsModuleState {
  /** Moduł jest włączony dla tego tenanta - wolno wołać RPC i renderować treść. */
  enabled: boolean;
  /** Odwrotność `enabled`, do czytelnego wczesnego `return` w trasie. */
  disabled: boolean;
}

export function useClubsModule(): ClubsModuleState {
  const modules = useCommunityModules();
  return { enabled: modules.clubs_enabled, disabled: !modules.clubs_enabled };
}
