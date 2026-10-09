// Wartość komórki siatki danych - odczyt szkicu i zapis liczby do pola.
//
// Osobny moduł (bez Reacta), bo te same reguły czytają komórki siatki
// wykresu i siatki mapy, a test sprawdza je bez montowania komponentu.
import { parseImportedCell, readImportedNumber } from "@/lib/charts/importNumber";

export const gridCellCls =
  "w-full min-w-[72px] h-8 rounded border border-border bg-background px-2 py-1.5 text-xs tabular-nums aria-[invalid=true]:border-destructive";

/** Wynik odczytu szkicu: `ok` - liczba albo świadoma luka; inaczej wpis do poprawy. */
export function readCellDraft(text: string): { ok: boolean; value: number | null } {
  if (text.trim() === "") return { ok: true, value: null };
  const { value } = parseImportedCell(text);
  if (value !== null) return { ok: true, value };
  return readImportedNumber(text).status === "missing"
    ? { ok: true, value: null }
    : { ok: false, value: null };
}

/**
 * Liczba do pola w KONWENCJI DOKUMENTU: wpis polski pokazuje przecinek
 * dziesiętny. Zapis zawsze idzie liczbą, więc wyświetlenie niczego nie
 * zmienia w treści; przecinek czyta z powrotem ta sama reguła.
 */
export function formatCellNumber(value: number | null, lang: "pl" | "en"): string {
  if (value === null || !Number.isFinite(value)) return "";
  const s = String(value);
  return lang === "pl" ? s.replace(".", ",") : s;
}
