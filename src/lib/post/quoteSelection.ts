// Reguły paska „udostępnij zaznaczony cytat".
//
// DLACZEGO OSOBNY MODUŁ: całość siedziała w `QuoteShareBar` - komponencie, który
// bez prawdziwego zaznaczenia w prawdziwym DOM-ie nie renderuje NICZEGO
// (`if (!state) return null`). Sprawdzenie limitów długości i treści udostępnienia
// wymagało więc sterowania `window.getSelection()`. Jako czyste funkcje
// przyjmujące deskryptor zaznaczenia są sprawdzalne wprost - i to one decydują
// o tym, co czytelnik wkleja na X i LinkedIn w imieniu redakcji.

/** Minimalna długość cytatu - krótsze zaznaczenie to przypadkowy klik. */
export const MIN_QUOTE_LEN = 8;

/** Maksymalna długość cytatu przyjmowana do paska. */
export const MAX_QUOTE_LEN = 600;

/**
 * Budżet znaków tekstu dla X: limit 280 minus 23 znaki, którymi X liczy KAŻDY
 * URL (niezależnie od jego prawdziwej długości), minus 6 na cudzysłowy
 * i separator.
 */
export const X_TEXT_BUDGET = 280 - 23 - 6;

/** Pozycja paska nad zaznaczeniem: odstęp w pikselach. */
const BAR_OFFSET_Y = 44;
/** Minimalny margines od krawędzi okna, żeby pasek się nie obciął. */
const BAR_EDGE_MARGIN = 90;
/** Minimalna odległość paska od górnej krawędzi okna. */
const BAR_MIN_TOP = 8;

/** Prostokąt zaznaczenia w układzie okna - tyle, ile potrzeba do pozycjonowania. */
export interface SelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Deskryptor paska: co udostępniamy i gdzie stoi. */
export interface QuoteBarState {
  quote: string;
  top: number;
  left: number;
}

/**
 * Normalizuje zaznaczony tekst do postaci cytatu: zwija białe znaki (zaznaczenie
 * przez kilka akapitów niesie łamania linii i wcięcia) i przycina krawędzie.
 */
export function normalizeQuote(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Czy zaznaczenie kwalifikuje się do paska.
 *
 * Dwa odrzucenia: za krótkie (przypadkowy klik, pojedyncze słowo) i za długie
 * (zaznaczenie całego artykułu - nie jest cytatem i nie zmieściłoby się nigdzie).
 */
export function isShareableQuote(quote: string): boolean {
  return quote.length >= MIN_QUOTE_LEN && quote.length <= MAX_QUOTE_LEN;
}

/**
 * Pozycja paska: nad zaznaczeniem, wyśrodkowana, dociśnięta do widocznego
 * obszaru okna. Bez docisku pasek dla cytatu przy krawędzi wychodziłby za ekran
 * i stawał się nieklikalny.
 */
export function quoteBarPosition(rect: SelectionRect, viewportWidth: number): QuoteBarState {
  return {
    quote: "",
    top: Math.max(BAR_MIN_TOP, rect.top - BAR_OFFSET_Y),
    left: Math.min(
      Math.max(rect.left + rect.width / 2, BAR_EDGE_MARGIN),
      viewportWidth - BAR_EDGE_MARGIN,
    ),
  };
}

/**
 * Pełny deskryptor paska z surowego zaznaczenia i jego prostokąta.
 * Zwraca `null`, gdy paska nie należy pokazywać - i to jest cała reguła.
 */
export function quoteBarState(
  rawSelection: string,
  rect: SelectionRect,
  viewportWidth: number,
): QuoteBarState | null {
  const quote = normalizeQuote(rawSelection);
  if (!isShareableQuote(quote)) return null;
  // Zaznaczenie zwinięte (np. w elemencie o zerowej wysokości) nie ma nad czym
  // postawić paska.
  if (rect.width === 0 && rect.height === 0) return null;
  return { ...quoteBarPosition(rect, viewportWidth), quote };
}

/**
 * Tekst cytatu dla X. Przycina do budżetu i domyka wielokropkiem, żeby nie
 * urwać zdania bez sygnału - a przede wszystkim, żeby X nie odrzucił wpisu.
 */
export function xQuoteText(quote: string): string {
  return quote.length > X_TEXT_BUDGET ? `${quote.slice(0, X_TEXT_BUDGET - 1).trimEnd()}…` : quote;
}

/** Adres intencji wpisu na X z cytatem i linkiem do artykułu. */
export function xShareUrl(quote: string, url: string): string {
  const text = `„${xQuoteText(quote)}”`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * Adres udostępnienia na LinkedIn. `share-offsite` przyjmuje WYŁĄCZNIE URL -
 * cytat trafia do schowka, żeby dało się go wkleić w okno posta.
 */
export function linkedinShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

/** Cytat w cudzysłowie - to, co ląduje w schowku pod LinkedIn. */
export function clipboardQuote(quote: string): string {
  return `„${quote}”`;
}

/** Cytat z atrybucją - to, co ląduje w schowku pod „Kopiuj cytat". */
export function attributedQuote(quote: string, siteName: string, url: string): string {
  return `„${quote}” - ${siteName}, ${url}`;
}
