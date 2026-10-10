// ZAPIS WIELU KLUCZY TREŚCI WIDGETU JAKO JEDEN KROK HISTORII.
//
// PO CO. Panel właściwości zapisuje treść widgetu przez `onChange(mut)`, a każde
// wywołanie to jeden `history.set` w `useBuilderOperations`. Edytory wykresu
// i mapy zmieniają kilka kluczy naraz (dane, kolory serii, seria wyróżniona,
// kategoria wyróżniona) - seria `setContent` dałaby kilka zapisów z tego samego
// renderu i, bez klucza zwijania, kilka kroków cofnięcia, z których pierwszy
// zostawiałby dokument w stanie pośrednim (dane nowe, akcent stary).
//
// Mutacja jest czysta względem wejścia `patch` i pracuje na KOPII treści:
// `useBuilderOperations` i tak podaje świeży klon dokumentu, ale panel testowy
// i inni wołający nie muszą tego gwarantować.
import type { Json, WidgetNode } from "./types";
import type { ContentPatch } from "./schemas";

/** Nowa treść: klucze z `patch` nadpisane, `undefined` USUWA klucz. */
export function applyContentPatch(
  content: Readonly<Record<string, Json>> | undefined,
  patch: ContentPatch,
): Record<string, Json> {
  const next: Record<string, Json> = { ...(content ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Mutacja węzła dla `onChange(mut)` panelu - jeden zapis, jeden krok historii. */
export function contentPatchMutation(patch: ContentPatch): (widget: WidgetNode) => void {
  return (widget) => {
    widget.content = applyContentPatch(widget.content, patch);
  };
}
