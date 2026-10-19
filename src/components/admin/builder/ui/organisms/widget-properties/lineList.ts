// Listy napisów „jedna pozycja na linię" w treści widgetów (rotujące teksty,
// słowa nagłówka animowanego). Czysta logika współdzielona przez
// `LineListTextarea` i edytory, które czytają te listy do podglądu.

/** Jedna pozycja na linię: przycięte, puste linie odrzucone. */
export function splitLineList(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Lista napisów z treści: tablica (nie-napisy odrzucone) albo starszy zapis
 *  jednym napisem z liniami - tak samo, jak czyta ją renderer publiczny. */
export function readLineList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw === "string") return splitLineList(raw);
  return [];
}
