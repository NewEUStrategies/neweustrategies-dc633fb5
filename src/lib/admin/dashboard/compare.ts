// PORÓWNANIE OKRES DO OKRESU - arytmetyka odznak delty na pulpicie.
//
// FORMATOWANIE IDZIE PRZEZ `lib/i18n/format`, nie przez własne `Intl` z kodem
// locale sklejonym na miejscu. To jest jedyne miejsce w repozytorium, gdzie
// język interfejsu zamienia się w region formatu (`uiLocale`), a kopia tej
// decyzji w każdym module kończy się rozjazdem en-US/en-GB - dokładnie tym,
// który tamten plik już raz posprzątał.
//
// Liczba bez odniesienia nie jest informacją zarządczą: "1240 sesji" nie mówi,
// czy trzeba coś robić. Dlatego każdy kafelek pulpitu niesie deltę wobec
// równoważnego okresu wstecz (patrz `period.ts`), a ten moduł trzyma całą
// arytmetykę tego porównania w jednym, czystym miejscu - żeby dwa kafelki nie
// policzyły "wzrostu o 100%" na dwa różne sposoby.

/**
 * Czy wzrost wartości jest dobrą wiadomością.
 *
 * TO NIE JEST OZDOBA. Kierunek zmiany (strzałka) i jej OCENA (kolor) to dwie
 * różne rzeczy i mylenie ich jest zwykłym źródłem kłamstwa na pulpicie: wzrost
 * wypisań z newslettera i wzrost zapisów mają tę samą strzałkę w górę, ale
 * przeciwną wymowę. Kafelek deklaruje więc biegunowość wprost, a kolor bierze
 * się z niej, nigdy z samego znaku różnicy.
 *
 * `neutral` jest dla wielkości, które po prostu są - liczba krajów, udział
 * języka - i których wzrost nie jest ani sukcesem, ani awarią.
 */
import { formatNumber, type UiLang } from "@/lib/i18n/format";

export type MetricPolarity = "higher-better" | "lower-better" | "neutral";

export type DeltaTone = "positive" | "negative" | "flat" | "unknown";

export interface MetricDelta {
  current: number;
  previous: number;
  /** Różnica bezwzględna (bieżący - poprzedni). */
  absolute: number;
  /**
   * Zmiana względna jako UŁAMEK (0.42 = +42%), albo `null`, gdy odniesienie
   * wynosi zero. Zero w mianowniku nie daje "wzrostu o 100%" ani o "∞" - daje
   * BRAK PODSTAWY do procentu, i tak to jest tu zapisane. Odznaka pokazuje
   * wtedy samą wartość bezwzględną ze słowem "nowe", a nie wymyślony procent.
   */
  ratio: number | null;
  tone: DeltaTone;
}

/**
 * Poniżej tego progu zmiana jest szumem, nie trendem, i dostaje ton `flat`.
 * Pół procenta na pulpicie odświeżanym co kilkanaście sekund zmieniałoby
 * strzałkę w górę i w dół bez żadnej treści.
 */
const FLAT_THRESHOLD = 0.005;

export function computeDelta(
  current: number,
  previous: number,
  polarity: MetricPolarity = "higher-better",
): MetricDelta {
  const absolute = current - previous;
  // Zero do zera to nie jest "brak odniesienia" - to zmierzony brak ruchu po
  // obu stronach, czyli zmiana zerowa. Odróżnienie tych dwóch przypadków
  // decyduje o tym, czy kafelek napisze "0%", czy "brak odniesienia".
  const ratio = previous === 0 ? (current === 0 ? 0 : null) : absolute / previous;

  let tone: DeltaTone;
  if (ratio === null) {
    tone = "unknown";
  } else if (Math.abs(ratio) < FLAT_THRESHOLD || absolute === 0) {
    tone = "flat";
  } else if (polarity === "neutral") {
    tone = "flat";
  } else {
    const better = polarity === "higher-better" ? absolute > 0 : absolute < 0;
    tone = better ? "positive" : "negative";
  }

  return { current, previous, absolute, ratio, tone };
}

/**
 * Procent do wypisania na odznace. `null` (brak odniesienia) NIE degraduje się
 * tu do zera - wołający ma pokazać inny napis, a nie fałszywe "0%".
 *
 * ZNAK, SEPARATOR I SYMBOL PROCENTU ZOSTAWIAMY `Intl`. Ręczne sklejanie
 * (`toFixed` + podmiana kropki na przecinek) jest tą samą decyzją o locale,
 * którą `uiLocale` podejmuje raz dla całego repozytorium - a przy okazji
 * zgaduje rzeczy, których zgadywać nie trzeba: czy przed "%" stoi spacja i po
 * której stronie liczby stoi minus.
 */
export function formatDeltaPercent(delta: MetricDelta, lang: UiLang): string | null {
  if (delta.ratio === null) return null;
  // Jedna cyfra po przecinku poniżej 10%, zero powyżej: przy dużych zmianach
  // ułamek procenta jest niemierzalny, przy małych bywa całą treścią.
  const digits = Math.abs(delta.ratio) < 0.1 ? 1 : 0;
  return formatNumber(delta.ratio, lang, {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Liczba całkowita w formacie lokalnym (separator tysięcy). */
export function formatCount(value: number, lang: UiLang): string {
  return formatNumber(Math.round(value), lang, { maximumFractionDigits: 0 });
}

/**
 * Kwota w groszach -> tekst waluty. Pulpit pokazuje pełne jednostki: przy
 * przychodzie miesięcznym grosze są szumem, a skracają miejsce na deltę.
 */
export function formatMoneyCents(cents: number, currency: string, lang: UiLang): string {
  return formatNumber(cents / 100, lang, {
    style: "currency",
    currency: currency || "PLN",
    maximumFractionDigits: 0,
  });
}

/**
 * Udział jako UŁAMEK (0.42 = 42%). Mianownik zero daje `null`, nie zero:
 * "0% otwarć" przy zerowej wysyłce twierdzi, że wysłano i nikt nie otworzył,
 * a to jest inna wiadomość niż "nie było czego otwierać".
 */
export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
