import { defineConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * KONFIGURACJA WYŁĄCZNIE POMIAROWA - NIE JEST UŻYWANA W CI.
 *
 * Jedyna różnica wobec `vitest.config.ts` to DOŁOŻONY plik setupu
 * `scripts/vitest/clockShiftSetup.ts`, który przesuwa `Date` o offset z
 * `CLOCK_SHIFT`. Progi, zakres pomiaru, pool i kolekcja testów zostają
 * nietknięte - to ten sam obiekt konfiguracji, rozszerzony o jedną pozycję.
 *
 * Powód istnienia osobnego pliku: vitest 4 nie ma już flagi `--setupFiles`
 * (jest tylko `-c/--config`), a zlecenie słusznie zabrania wpinania zamrożenia
 * czy przesunięcia zegara na stałe w `vitest.config.ts`. Wrapper trzyma obie
 * te rzeczy naraz: konfiguracja produkcyjna zostaje bez zmian, a przesunięcie
 * podaje się doraźnie:
 *
 *   CLOCK_SHIFT=1y ./node_modules/.bin/vitest run -c vitest.clockshift.config.ts
 *
 * Bez `CLOCK_SHIFT` plik setupu jest no-opem, więc przebieg jest wtedy
 * równoważny zwykłemu `vitest run` - i to jest kontrola, że wrapper niczego nie
 * psuje sam z siebie.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    setupFiles: ["./vitest.setup.ts", "./scripts/vitest/clockShiftSetup.ts"],
  },
});
