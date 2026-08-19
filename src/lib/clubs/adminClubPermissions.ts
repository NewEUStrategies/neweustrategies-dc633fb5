// Zakładka „Uprawnienia" - SKŁADANIE macierzy i PODGLĄDU jako czyste funkcje.
//
// CO BYŁO W JSX-IE I DLACZEGO TO REGUŁA, A NIE UKŁAD. Sama macierz jest DANYMI
// i mieszka w `capabilityMatrix.ts` (tam też jest jej test). Ten moduł nie
// powtarza ani jednej komórki - dokłada to, co siedziało w ciele
// `ClubPermissionsTab.tsx` i decydowało o tym, CO administrator zobaczy:
//
//   1. CZTERY STANY PODGLĄDU, NIE DWA. Łańcuch `previewUserId.length === 0 ? …
//      : previewQ.isPending ? … : previewQ.data ? … : null` w JSX-ie mieszał
//      trzy różne pytania (czy ktoś jest wybrany, czy zapytanie leci, czy
//      odpowiedź jest) i miał czwarte ramię bez nazwy - awarię RPC. Kolejność
//      jest tu regułą: „wybierz osobę" MUSI wygrać z szkieletem wczytywania,
//      bo zapytanie bez osoby nawet nie startuje (`enabled`), więc szkielet
//      wisiałby na ekranie bez końca.
//   2. PUSTY WYBÓR NIE PYTA BAZY. `userId: previewUserId.length > 0 ?
//      previewUserId : undefined` to nie kosmetyka - `undefined` wyłącza
//      zapytanie. Bez tego panel puka do `club_capabilities()` po każdym
//      wyczyszczeniu wyboru.
//   3. PODGLĄD RENDERUJE SIĘ Z ODPOWIEDZI RPC, NIGDY Z MACIERZY. Nagłówek
//      organizmu mówi to wprost: gdyby oba źródła się rozjechały, prawdą jest
//      baza. Dlatego wiersze podglądu powstają z `readCapability(caps, key)`,
//      a nie z `capabilityValue(key, role)` - i dlatego POWÓD odmowy jedzie
//      w podglądzie razem z rolą efektywną.
//   4. BRAK POWODU TO TEŻ ODPOWIEDŹ. `reason === null` znaczy „nic nie stoi na
//      drodze" i ma własną etykietę; bez tej gałęzi w wierszu zostawał goły
//      klucz `club.reason.` bez ogona.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta Supabase. Klucze
// przestrzeni `club.*` wracają GOTOWE (są w słowniku publicznym), a etykiety
// panelu wracają jako KRÓTKIE deskryptory (`yes`/`conditional`/`no`), które
// komponent dokleja do swojego prefiksu - słownik panelu ładuje się warunkowo
// i jego nazwy nie mają prawa siedzieć w warstwie reguł.
import {
  CAPABILITY_KEYS,
  CAPABILITY_ROLES,
  capabilityValue,
  readCapability,
  type CapabilityKey,
  type CapabilityRole,
  type CapabilityValue,
} from "./capabilityMatrix";
import type { ClubCapabilities } from "./types";

/** Jedna komórka macierzy - rola plus wartość ze `capabilityMatrix`. */
export interface CapabilityMatrixCell {
  role: CapabilityRole;
  value: CapabilityValue;
}

/** Jeden wiersz macierzy - zdolność plus komórki w kolejności kolumn. */
export interface CapabilityMatrixRow {
  key: CapabilityKey;
  cells: CapabilityMatrixCell[];
}

/**
 * Macierz przepisana na wiersze do narysowania. Kolejność wierszy i kolumn
 * jest kolejnością słowników - nie sortujemy jej w widoku, bo to ONA jest
 * dokumentacją migracji `club_capabilities`.
 */
export function clubCapabilityMatrixRows(): CapabilityMatrixRow[] {
  return CAPABILITY_KEYS.map((key) => ({
    key,
    cells: CAPABILITY_ROLES.map((role) => ({ role, value: capabilityValue(key, role) })),
  }));
}

/**
 * Deskryptor etykiety komórki. Zamknięta unia `CapabilityValue` odwzorowana
 * REKORDEM, a nie łańcuchem `if`-ów - dzięki temu nowa wartość macierzy nie
 * przecieka do gałęzi „wszystko inne" (czyli do minusa udającego „nie wolno").
 */
export const CAPABILITY_CELL_LABEL: Record<CapabilityValue, "yes" | "conditional" | "no"> = {
  yes: "yes",
  cond: "conditional",
  no: "no",
};

/** Identyfikator osoby dla zapytania podglądu; pusty wybór NIE pyta bazy. */
export function capabilityPreviewUserId(raw: string): string | undefined {
  return raw.length > 0 ? raw : undefined;
}

/** Rola efektywna i powód odmowy jako gotowe klucze przestrzeni publicznej. */
export interface CapabilityPreviewSummary {
  roleKey: string;
  /** `null` = brak przeszkód; etykietę tego przypadku ma panel. */
  reasonKey: string | null;
}

/** Jedna zdolność w podglądzie - wartość CZYTANA Z RPC, nie z macierzy. */
export interface CapabilityPreviewRow {
  key: CapabilityKey;
  granted: boolean;
}

/** Stan sekcji „Podgląd jako..." - patrz punkt 1 nagłówka. */
export type CapabilityPreviewState =
  | { kind: "empty" }
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "ready"; summary: CapabilityPreviewSummary; rows: CapabilityPreviewRow[] };

/** Rola i powód z odpowiedzi RPC. */
export function capabilityPreviewSummary(caps: ClubCapabilities): CapabilityPreviewSummary {
  return {
    roleKey: `club.role.${caps.effectiveRole}`,
    reasonKey: caps.reason === null ? null : `club.reason.${caps.reason}`,
  };
}

/** Wiersze podglądu w kolejności macierzy, z wartościami z RPC. */
export function capabilityPreviewRows(caps: ClubCapabilities): CapabilityPreviewRow[] {
  return CAPABILITY_KEYS.map((key) => ({ key, granted: readCapability(caps, key) }));
}

/**
 * Stan sekcji podglądu. Kolejność sprawdzeń jest częścią reguły: brak wyboru
 * osoby wygrywa z „w locie", a brak danych przy niepustym wyborze i zakończonym
 * zapytaniu znaczy AWARIĘ, nie pustkę.
 */
export function capabilityPreviewState(input: {
  userId: string;
  isPending: boolean;
  caps: ClubCapabilities | undefined;
}): CapabilityPreviewState {
  if (input.userId.length === 0) return { kind: "empty" };
  if (input.isPending) return { kind: "pending" };
  if (input.caps === undefined) return { kind: "unavailable" };
  return {
    kind: "ready",
    summary: capabilityPreviewSummary(input.caps),
    rows: capabilityPreviewRows(input.caps),
  };
}
