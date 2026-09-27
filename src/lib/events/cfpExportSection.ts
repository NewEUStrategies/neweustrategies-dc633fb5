// Rozbiór zwrotki `event_cfp_export_my_data` na sekcje eksportu RODO.
//
// Nabór prelegentów jedzie do paczki danych osobowych JEDNYM wywołaniem
// SECURITY DEFINER RPC (tabele naboru mają wyłącznie polityki odczytu dla
// administratora, więc odczyt tabel klientem użytkownika oddałby pustkę
// wyglądającą jak „nie korzystam"). Zwrotka to obiekt jsonb z czterema listami,
// a paczka ma cztery osobne sekcje - ten moduł robi dokładnie to przejście.
//
// DLACZEGO OSOBNY MODUŁ, A NIE DOMKNIĘCIE W SERVER FN. `export.functions.ts`
// świadomie nie ma pokrycia runtime'owego (dwie bramki statyczne zamiast atrapy
// całego klienta Supabase - patrz wpis progu w `vitest.config.ts`), więc każda
// gałąź dopisana w jej ciele jest gałęzią, której nikt nigdy nie wykonał.
// A te gałęzie niosą obietnice wobec osoby, której dane dotyczą: odmowa bazy
// ma wrócić JAKO BŁĄD sekcji (i trafić do `manifest.failed`), a nie jako pusta
// lista; brak klucza w zwrotce ma dać `[]`, a nie `undefined` w pliku. Tutaj
// każdą z nich da się sprawdzić bez bazy.
//
// ZACHOWANIE JEST 1:1 Z DOMKNIĘCIEM, KTÓRE TEN MODUŁ ZASTĄPIŁ: błąd przechodzi
// tym samym obiektem, a wiersze tą samą referencją - bez kopiowania i bez
// mapowania pól (kształt wierszy należy do RPC, nie do klienta).
import type { Json } from "@/integrations/supabase/types";
import type { EXPORT_SECTION_GROUPS } from "@/lib/profile/exportManifest";

/**
 * Sekcje paczki wypełniane z tej zwrotki. Typ jest WYPROWADZONY z rejestru
 * (`EXPORT_SECTION_GROUPS.event_cfp`), a nie przepisany: klucz spoza grupy
 * naboru nie przejdzie kompilacji, więc emiter nie może poprosić RPC o sekcję,
 * której manifest nie deklaruje w tej grupie.
 */
export type CfpExportSectionId = (typeof EXPORT_SECTION_GROUPS)["event_cfp"][number];

/** Odpowiedź RPC w kształcie, w jakim oddaje ją klient Supabase. */
export interface CfpExportRpcResult<E extends { message: string }> {
  data: Json | null;
  error: E | null;
}

/** Jedna sekcja paczki - kontrakt `SectionResult` z `export.functions.ts`. */
export interface CfpExportSection<E extends { message: string }> {
  data: Json | null;
  error: E | null;
}

/**
 * Wyciąga jedną sekcję paczki ze zwrotki `event_cfp_export_my_data`.
 *
 * - Odmowa bazy daje sekcję z BŁĘDEM i bez danych - eksport nigdy nie udaje
 *   kompletności, której nie ma (`manifest.failed` liczy się z tego pola).
 * - Zwrotka, która nie jest obiektem (`null`, lista, skalar - rozjazd kontraktu
 *   jsonb), daje pustą listę: zawężenie zamiast rzutu, bez błędu silnika JS
 *   przy odczycie klucza z `null`.
 * - Brak klucza albo jawny `null` pod kluczem daje `[]`, nie `undefined`.
 */
export function cfpExportSection<E extends { message: string }>(
  result: CfpExportRpcResult<E>,
  key: CfpExportSectionId,
): CfpExportSection<E> {
  if (result.error) return { data: null, error: result.error };
  const payload = result.data;
  const rows =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload[key] ?? [])
      : [];
  return { data: rows, error: null };
}
