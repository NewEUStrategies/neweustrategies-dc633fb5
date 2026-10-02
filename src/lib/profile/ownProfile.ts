// Kanoniczny odczyt WŁASNEGO wiersza `profiles` po stronie klienta.
//
// DLACZEGO RPC, A NIE `.from("profiles").select(...)`. Polityka odczytu
// `profiles` wpuszcza staff (także niskozaufaną rolę `author`) do CUDZYCH
// wierszy tenanta, więc jedyną zaporą dla danych prywatnych jest grant
// kolumnowy: kolumny z `OWNER_ONLY_PROFILE_COLUMNS` celowo NIE mają SELECT dla
// roli `authenticated` (kontrakt negatywny 20260801120000, pgTAP
// `pii_column_grants_test` / `profiles_pii_grant_test`). Select wymieniający
// choć jedną z nich nie oddaje pustej kolumny - PostgREST odrzuca CAŁE
// zapytanie kodem 42501. Tak właśnie pulpit /profile wstawał z pustym
// profilem: edytor prosił o `phone, location, gender, current_company_id`.
//
// Właściciel czyta je przez `get_own_profile()` - SECURITY DEFINER twardo
// zawężony do `auth.uid()` (20260703090100), więc z definicji nie sięga
// cudzego wiersza i nie przyjmuje żadnego argumentu, który dałoby się podmienić.
// Otwarcie grantu kolumn „bo edytor ich potrzebuje" zniosłoby ochronę dla
// wszystkich zalogowanych naraz - dlatego tego NIE robimy.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/** Pełny wiersz zwracany przez `get_own_profile()` (SETOF profiles). */
export type OwnProfileRow = Database["public"]["Functions"]["get_own_profile"]["Returns"][number];

/**
 * Kolumny `profiles` BEZ grantu SELECT dla `authenticated` - czytelne dla
 * właściciela wyłącznie przez `get_own_profile()`, dla admina przez
 * `admin_get_user()`. Lista jest lustrem kontraktu negatywnego z migracji
 * 20260801120000; bramka `profileColumnGrants.gate.test.ts` pilnuje, żeby
 * żaden klientowy select powierzchni profilu ich nie wymieniał.
 */
export const OWNER_ONLY_PROFILE_COLUMNS = [
  "email",
  "prefs",
  "contact_email",
  "phone",
  "gender",
  "location",
  "verified_by",
  "discovery_search",
  "current_company_id",
  // Bez grantu SELECT od dodania kolumny (20260807061849); własna wartość
  // przełącznika „ukryj zdjęcie" idzie przez `get_own_profile()`.
  "hide_avatar",
] as const;

/**
 * Własny wiersz profilu albo `null`, gdy wiersza NIE MA (świeża rejestracja
 * przed triggerem zakładającym profil).
 *
 * Błąd PODNOSI, zamiast oddawać `null`: „nie udało się przeczytać" i „profil
 * jest pusty" to dwie różne informacje. Wołający, który by je skleił, podaje
 * użytkownikowi pusty formularz - a pierwszy zapis takiego formularza
 * nadpisuje prawdziwe dane pustymi wartościami.
 */
export async function fetchOwnProfileRow(): Promise<OwnProfileRow | null> {
  const { data, error } = await supabase.rpc("get_own_profile");
  if (error) throw error;
  return data?.[0] ?? null;
}
