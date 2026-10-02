// Wspólne klocki dwóch paneli programów: `/admin/research-programs` (landing
// think-tanku) i `/admin/programs` (programy huba eksperta).
//
// DLACZEGO WSPÓLNE. Od migracji `20260815110844` `research_programs` jest
// WIDOKIEM na tabelę `programs` - oba panele piszą TE SAME wiersze. Reguły
// zapisu (wzorzec slugu, reakcja na odmowę bazy, lista kluczy cache czytających
// wiersz programu) nie mogą się więc między panelami rozjeżdżać, a dotąd każda
// mieszkała w kilkunastu kopiach rozsianych po domknięciach `onClick`.
import type { Dispatch, SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Wzorzec slugu programu. Slug jest adresem strony publicznej
 * (`/programs/$slug`) i filtrem katalogu ekspertów, więc oba panele walidują go
 * PRZED zapytaniem, tym samym wyrażeniem.
 */
export const PROGRAM_SLUG_PATTERN = /^[a-z0-9-]{2,80}$/;

/** Zdarzenie pola tekstowego - wspólny kształt `<Input>` i `<Textarea>`. */
interface TextChange {
  readonly target: { readonly value: string };
}

/** Klucze o wartości tekstowej (`string` albo `string | null`). */
type TextKey<T> = {
  [K in keyof T]-?: string extends T[K] ? (T[K] extends string | null ? K : never) : never;
}[keyof T];
/** Klucze tekstowe dopuszczające `null` - kolumny opcjonalne. */
type NullableTextKey<T> = {
  [K in keyof T]-?: null extends T[K] ? (K extends TextKey<T> ? K : never) : never;
}[keyof T];
/** Klucze z wartością z listy wyboru (tekst albo unia literałów enuma). */
type ChoiceKey<T> = { [K in keyof T]-?: T[K] extends string ? K : never }[keyof T];
type NumberKey<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];
type FlagKey<T> = { [K in keyof T]-?: T[K] extends boolean ? K : never }[keyof T];

/**
 * Wiązanie kontrolek formularza z WERSJĄ ROBOCZĄ wiersza.
 *
 * JEDNO MIEJSCE ZAMIAST TRZYDZIESTU DOMKNIĘĆ. Panele miały
 * `onChange={(e) => setForm((f) => ({ ...f, tagline_pl: e.target.value || null }))}`
 * w kilkunastu kopiach różniących się wyłącznie nazwą kolumny - a pomyłka w tej
 * nazwie (`tagline_en` w polu PL) nie oblewa kompilacji i w review jest
 * niewidoczna. Tutaj nazwa kolumny jest argumentem typowanym kluczami wersji
 * roboczej, a reguły zapisu mieszkają raz:
 *   - `text`         - wartość jedzie dosłownie (także pusty ciąg);
 *   - `optionalText` - PUSTE pole to `NULL` w kolumnie opcjonalnej;
 *   - `number`       - śmieci i puste pole to `0`, nie `NaN`;
 *   - `choice`       - wartość z listy wyboru (`onValueChange`);
 *   - `flag`         - przełącznik (`onCheckedChange`).
 * `id` pola (`${idPrefix}-${klucz}`) wiąże je z etykietą `<Label htmlFor>`.
 */
export function bindDraft<T extends object>(
  draft: T,
  setDraft: Dispatch<SetStateAction<T>>,
  idPrefix: string,
) {
  const put = (key: keyof T, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const id = (key: keyof T & string) => `${idPrefix}-${key}`;
  return {
    id,
    text: <K extends TextKey<T> & keyof T & string>(key: K) => ({
      id: id(key),
      value: draft[key] ?? "",
      onChange: (event: TextChange) => put(key, event.target.value),
    }),
    optionalText: <K extends NullableTextKey<T> & keyof T & string>(key: K) => ({
      id: id(key),
      value: draft[key] ?? "",
      onChange: (event: TextChange) => put(key, event.target.value || null),
    }),
    number: <K extends NumberKey<T> & keyof T & string>(key: K) => ({
      id: id(key),
      value: draft[key],
      onChange: (event: TextChange) => put(key, Number(event.target.value) || 0),
    }),
    choice: <K extends ChoiceKey<T> & keyof T & string>(key: K) => ({
      value: draft[key],
      onValueChange: (value: string) => put(key, value),
    }),
    flag: <K extends FlagKey<T> & keyof T & string>(key: K) => ({
      id: id(key),
      checked: draft[key],
      onCheckedChange: (value: boolean) => put(key, value),
    }),
  };
}

/** Wynik zapisu PostgREST w kształcie, którego potrzebuje reakcja panelu. */
export interface WriteResult {
  readonly error: { readonly message: string } | null;
}

/**
 * Zapis z panelu. Odmowa bazy (RLS, unikalność, CHECK) daje toast z jej
 * komunikatem i `false` - wołający NIE zamyka okna, NIE czyści wersji roboczej
 * i NIE chwali, bo zamknięte okno po odmowie wygląda jak wykonany zapis.
 */
export async function writeOrToast(request: PromiseLike<WriteResult>): Promise<boolean> {
  const { error } = await request;
  if (error) {
    toast.error(error.message);
    return false;
  }
  return true;
}

/**
 * Klucze cache, które CZYTAJĄ wiersz `programs` - i dlatego unieważnia je
 * każdy zapis programu w KTÓRYMKOLWIEK z dwóch paneli:
 *   - oba panele (ten sam wiersz, dwa widoki);
 *   - `["programs"]` - publiczny katalog i landing (`lib/queries/programs.ts`)
 *     oraz lista programów do tagowania w edytorze wpisu
 *     (`usePostEditorData`: `["programs", tenantId]`, staleTime 5 min);
 *   - katalog ekspertów (filtr po programie) i strona eksperta (nazwa programu).
 * Zapis, który rusza tylko klucz panelu, daje redakcji wrażenie wykonanej pracy
 * i zostawia czytelnikowi stary katalog.
 */
export const PROGRAM_ROW_READERS: readonly (readonly string[])[] = [
  ["admin-programs"],
  ["admin-research-programs"],
  ["programs"],
  ["public", "experts-directory"],
  ["public", "expert"],
];

export function invalidateProgramReaders(qc: QueryClient): void {
  for (const queryKey of PROGRAM_ROW_READERS) void qc.invalidateQueries({ queryKey });
}
