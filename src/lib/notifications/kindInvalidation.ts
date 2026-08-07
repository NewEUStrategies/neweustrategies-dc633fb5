// Powiadomienie jako ZDARZENIE DOMENOWE dla innych modułów - czysta mapa
// rodzaj -> klucze React Query do unieważnienia.
//
// PO CO. Karty „Kto oglądał Twój profil", „Wprowadzenia", sekcja rekomendacji i
// liczniki poparć czytają dane przez RPC (`my_profile_viewers`,
// `my_introduction_requests`, `list_recommendations`,
// `skill_endorsement_counts`), a ich tabele mają RLS zamykający bezpośredni
// odczyt (`pv_no_direct_read`, zapisy wyłącznie przez RPC). Nie da się na nich
// postawić subskrypcji Realtime, więc do 08.2026 karta pokazywała stan z chwili
// wejścia na ekran: poparcie albo prośba o wprowadzenie z drugiej karty
// przeglądarki pojawiały się dopiero po F5.
//
// Wiersz w `notifications` jest natomiast subskrybowany per użytkownik
// (`useNotificationsRealtime`) i powstaje w TEJ SAMEJ transakcji, co zdarzenie
// domenowe (producenci są triggerami AFTER). Skrzynka jest więc jedynym
// dostępnym - i dokładnym - kanałem powiadamiania modułów o zmianie ich danych.
//
// Mapa jest tutaj (czysty modul, bez Reacta i bez Supabase), a nie w hooku,
// dokładnie z tego powodu, z którego `eventInvalidationMap` nie mieszka w
// `useModuleRealtime`: reguła „co odświeżyć" jest wiedzą domenową i musi mieć
// test jednostkowy, nie przebieg w przeglądarce.
import type { QueryKey } from "@tanstack/react-query";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { clubKeys } from "@/lib/clubs/queryKeys";
import type { NotificationKind } from "./preferences";

/**
 * Klucze do unieważnienia dla rodzaju powiadomienia. Prefiksy są celowo krótkie
 * (`["network", "recommendations"]` bez id widza i profilu): klucze modułów są
 * skalowane widzem i podmiotem, a przy odbiorze powiadomienia nie znamy tych
 * współrzędnych - a unieważnienie prefiksu i tak dotyka wyłącznie zapytań
 * TEGO klienta.
 *
 * Rodzaj nieobecny w mapie nie unieważnia niczego poza samą skrzynką (to nie
 * błąd - `system`, `security` czy `content` nie mają własnego widoku listy,
 * który mógłby się zdezaktualizować).
 */
const KIND_INVALIDATION: Partial<Record<NotificationKind, readonly QueryKey[]>> = {
  // Zaproszenia do sieci: lista otrzymanych/wysłanych + licznik w nagłówku.
  connection: [
    ["network", "requests"],
    ["network", "connections"],
    ["network", "counts"],
  ],
  introduction: [["network", "introductions"]],
  recommendation: [["network", "recommendations"]],
  endorsement: [["network", "endorsements"]],
  // Karta wyświetleń to lista widzów ORAZ liczniki 7/30/90 dni - dwa zapytania.
  profile_view: [
    ["network", "profile-viewers"],
    ["network", "profile-view-stats"],
  ],
  // Rezerwacja zajmuje slot 1-1 na wyłączność, więc publiczna siatka widgetu
  // „meeting-booking" (is_booked/booked_by_me) przestaje być prawdziwa
  // natychmiast - dla hosta i dla rezerwującego.
  meeting_booking: [[WIDGET_QUERY_ROOTS.meetingSlots]],
  // Kluby: tabele club_* maja RLS deny-all, wiec wiersz w `notifications` jest
  // JEDYNYM subskrybowalnym kanalem tego modulu i powstaje w tej samej
  // transakcji co zmiana. Prefiks calego modulu, bo w chwili odbioru nie znamy
  // ani clubId, ani threadId - powiadomienie niesie tylko href.
  club: [clubKeys.all],
};

/** Klucze do unieważnienia po nadejściu powiadomienia danego rodzaju. */
export function invalidationKeysForNotificationKind(kind: string): readonly QueryKey[] {
  return KIND_INVALIDATION[kind as NotificationKind] ?? [];
}

/** Rodzaje, które realnie odświeżają jakiś inny moduł (diagnostyka + testy). */
export function notificationKindsWithSideEffects(): readonly NotificationKind[] {
  return Object.keys(KIND_INVALIDATION) as NotificationKind[];
}
