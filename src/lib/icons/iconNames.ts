// KATALOG NAZW IKON - BEZ DANYCH SVG.
//
// Lista nazw pochodzi z `iconNames.generated.json`, który
// `scripts/generate-icon-chunks.mjs` zapisuje razem z porcjami danych SVG
// (`Object.keys(LUCIDE_ICON_NODES).sort()`; zgodność z rejestrem pilnuje
// `__tests__/iconChunks.test.ts`). Import tego modułu kosztuje więc same
// nazwy (23,5 KB źródła), a nie rejestr węzłów SVG
// (`lucideIconNodes.generated.ts`, 473 KB) ani żadną z porcji.
//
// Do 2026-10-03 obie funkcje mieszkały w `DynamicIconFull.tsx`, który
// importował cały rejestr węzłów. Po przejściu `DynamicIcon` na porcje
// (`lazyNamedIcon.ts`) tamten moduł nie miał już żadnego importu
// produkcyjnego - jedynym klientem był test - więc został usunięty, a nazwy
// przeniesione tutaj.
import iconNames from "./iconNames.generated.json";

/**
 * "XLineTop" -> "x-line-top", "Building2" -> "building-2" (klucze danych).
 *
 * Tę samą normalizację robi w miejscu `lazyNamedIcon.ts`, zanim wyliczy numer
 * porcji - zmiana reguły musi trafić w oba miejsca, inaczej testy tej funkcji
 * (`lib/__tests__/brandIcons.test.ts`) pilnowałyby reguły, której loader
 * porcji już nie stosuje.
 */
export function pascalToKebabIconName(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

/** Kanoniczne, kebab-case'owe nazwy wszystkich ikon (katalog dla pickerów). */
export function allIconNames(): string[] {
  // Kopia, nie współdzielona tablica z importu JSON: wołający może ją
  // sortować albo przycinać w miejscu bez psucia katalogu innym.
  return [...iconNames];
}
