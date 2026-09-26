// Baseline ratchetu `check:i18n-overlay-imports` (`scripts/lib/i18nOverlayImportBaseline.ts`)
// jako DANE - bramka czyta go przez `new Map(...)`, więc błąd w samym pliku nie
// wywraca skryptu, tylko po cichu zmienia próg.
//
// CO TU JEST PILNOWANE.
//   1. JEDNA POZYCJA NA PLIK. `new Map` z duplikatu bierze OSTATNIĄ liczbę - ręczna
//      poprawka dopisana obok starej pozycji podnosiłaby (albo zbijała) próg
//      bez śladu w przeglądzie.
//   2. LICZBY DODATNIE I CAŁKOWITE. Zero znaczy „plik ma import wprost" - taka
//      pozycja ma zniknąć z listy, a nie stać jako martwy wyjątek.
//   3. KOLEJNOŚĆ JAK Z `--print-baseline` (po ścieżce, `localeCompare`). Lista
//      ułożona inaczej dawałaby przy każdym odświeżeniu różnicę na setkach linii,
//      w której ginie jedna prawdziwa zmiana.
//   4. PLIK, KTÓRY DOSTAŁ IMPORT WPROST, NIE WRACA. Podstrony modułowe podglądu
//      studia (`EventPreviewLiveModule.tsx`) importują słownik panelu same - ratchet
//      zszedł o tę pozycję i ma tak zostać.
import { describe, expect, it } from "vitest";

import { I18N_OVERLAY_IMPORT_BASELINE } from "../../../../scripts/lib/i18nOverlayImportBaseline";

const files = I18N_OVERLAY_IMPORT_BASELINE.map(([file]) => file);

describe("baseline ratchetu importów nakładek i18n", () => {
  it("ma jedną pozycję na plik", () => {
    expect(new Set(files).size).toBe(files.length);
  });

  it("niesie wyłącznie dodatnie liczby całkowite", () => {
    const zle = I18N_OVERLAY_IMPORT_BASELINE.filter(
      ([, count]) => !Number.isInteger(count) || count <= 0,
    );
    expect(zle).toEqual([]);
  });

  it("stoi w kolejności `--print-baseline`", () => {
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
  });

  it("nie trzyma pozycji dla podstron modułowych podglądu - importują słownik wprost", () => {
    expect(files).not.toContain("src/components/admin/events/studio/EventPreviewLiveModule.tsx");
  });
});
