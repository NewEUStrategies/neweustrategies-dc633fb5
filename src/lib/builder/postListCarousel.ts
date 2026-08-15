// Kontrakt autoodtwarzania karuzeli wpisów (widget "carousel").
//
// PROBLEM, KTORY TEN MODUL LIKWIDUJE
// Pole `autoplay` istnialo wylacznie w martwym schemacie (WIDGET_SCHEMAS.carousel),
// ktorego panel nigdy nie renderowal, a karuzela byla czystym scroll-snapem -
// ustawienie bylo martwe podwojnie: nieedytowalne i niekonsumowane. Zeby ta
// klasa bledu nie wrocila, jedna definicja "co znaczy autoplay" obsluguje i
// edytor (PostListEditor), i renderer (PostListView).
//
// Modul jest czysty (bez Reacta i DOM-u), wiec kontrakt jest testowalny wprost.
import type { WidgetContent } from "@/lib/builder/types";
import { asBool, asNumInRange } from "@/lib/content-model/contentValue";

/** Granice tempa slajdow. Ponizej ~1,5 s karuzela jest nieczytelna, powyzej
 *  30 s przestaje byc karuzela. Edytor uzywa tych samych liczb w `min`/`max`. */
export const CAROUSEL_AUTOPLAY_MIN_MS = 1500;
export const CAROUSEL_AUTOPLAY_MAX_MS = 30000;
export const CAROUSEL_AUTOPLAY_DEFAULT_MS = 5000;

/**
 * Czy karuzela ma sie przewijac sama. Domyslnie NIE - autoplay jest swiadoma
 * decyzja redakcji, nie zachowaniem, ktore pojawia sie samo po aktualizacji.
 *
 * `asBool` obsluguje historyczny zapis selecta ("on"/"off") ze starego
 * schematu, wiec tresc zapisana przed migracja na `bool` dziala dalej.
 */
export function carouselAutoplayEnabled(c: WidgetContent): boolean {
  return asBool(c["autoplay"], false);
}

/** Czas jednego slajdu w ms, domkniety do [MIN, MAX] i zaokraglony. */
export function carouselAutoplayIntervalMs(c: WidgetContent): number {
  return Math.round(
    asNumInRange(
      c["autoplayIntervalMs"],
      CAROUSEL_AUTOPLAY_DEFAULT_MS,
      CAROUSEL_AUTOPLAY_MIN_MS,
      CAROUSEL_AUTOPLAY_MAX_MS,
    ),
  );
}
