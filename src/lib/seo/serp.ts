// SERP snippet metrics: Google truncates titles and descriptions by rendered
// PIXEL width (Arial 20px / 14px), not by character count, so a plain length
// counter misleads editors ("WWW" is 3 chars but 3x wider than "iii"). This
// module estimates the rendered width with a per-character-class width table -
// the same approach Yoast uses - and grades the result for the admin panel.
// Pure and framework-free, shared by the SERP preview and unit tests.

/** Approximate advance widths (px) for Arial at 20px (SERP title size). */
const TITLE_FONT_PX = 20;
/** Google cuts desktop titles at ~600px and descriptions at ~960px. */
export const SERP_TITLE_LIMIT_PX = 600;
export const SERP_DESCRIPTION_LIMIT_PX = 960;

/** Sensible authoring ranges (px) used for grading, mirroring Yoast's bounds. */
const SERP_TITLE_MIN_PX = 200;
const SERP_DESCRIPTION_MIN_PX = 400;

// Width classes as fractions of the font size (empirically close to Arial
// metrics; exactness is not required - the grade bands are wide).
const NARROW = 0.28; // i j l ' | ! .
const THIN = 0.42; // f t r ( ) [ ] - " space-ish
const REGULAR = 0.56; // most lowercase, digits
const WIDE = 0.72; // uppercase, some lowercase (m w handled below)
const EXTRA_WIDE = 0.92; // m M w W @

function classifyChar(ch: string): number {
  if (/[ijl'|!.,:;]/.test(ch)) return NARROW;
  if (/[ftr()[\]"\- ]/.test(ch)) return THIN;
  if (/[mwMW@]/.test(ch)) return EXTRA_WIDE;
  if (/[A-ZĄĆĘŁŃÓŚŹŻ%&]/.test(ch)) return WIDE;
  return REGULAR;
}

// Pamięć klas szerokości: pole SEO mierzy cały napis przy KAŻDYM naciśnięciu
// klawisza (licznik px, ocena, podgląd SERP - po kilka pomiarów na pole), a
// alfabet redakcji to kilkadziesiąt znaków. Jedno trafienie w Map zamiast do
// czterech wyrażeń regularnych na znak; wynik jest identyczny z `classifyChar`.
// Rozmiar ograniczony - wklejony tekst z egzotycznymi znakami nie rozdmucha
// pamięci karty redaktora.
const CHAR_FACTOR_CACHE_MAX = 512;
const charFactorCache = new Map<string, number>();

function charWidthFactor(ch: string): number {
  const cached = charFactorCache.get(ch);
  if (cached !== undefined) return cached;
  const factor = classifyChar(ch);
  if (charFactorCache.size < CHAR_FACTOR_CACHE_MAX) charFactorCache.set(ch, factor);
  return factor;
}

/** Estimated rendered width (px) of a string at the given font size. */
export function estimateTextWidthPx(text: string, fontSizePx: number): number {
  let units = 0;
  for (const ch of text) units += charWidthFactor(ch);
  return Math.round(units * fontSizePx);
}

type SerpGrade = "empty" | "short" | "good" | "long";

export interface SerpMetric {
  px: number;
  limitPx: number;
  /** 0..1 fill ratio against the truncation limit (may exceed 1). */
  ratio: number;
  grade: SerpGrade;
}

function grade(px: number, minPx: number, limitPx: number): SerpGrade {
  if (px === 0) return "empty";
  if (px < minPx) return "short";
  if (px > limitPx) return "long";
  return "good";
}

/** Metrics for a SERP title candidate. */
export function serpTitleMetric(text: string): SerpMetric {
  const px = estimateTextWidthPx(text.trim(), TITLE_FONT_PX);
  return {
    px,
    limitPx: SERP_TITLE_LIMIT_PX,
    ratio: px / SERP_TITLE_LIMIT_PX,
    grade: grade(px, SERP_TITLE_MIN_PX, SERP_TITLE_LIMIT_PX),
  };
}

/** Metrics for a SERP description candidate (14px font). */
export function serpDescriptionMetric(text: string): SerpMetric {
  const px = estimateTextWidthPx(text.trim(), 14);
  return {
    px,
    limitPx: SERP_DESCRIPTION_LIMIT_PX,
    ratio: px / SERP_DESCRIPTION_LIMIT_PX,
    grade: grade(px, SERP_DESCRIPTION_MIN_PX, SERP_DESCRIPTION_LIMIT_PX),
  };
}

/** Wielokropek doklejany do uciętego snippetu. */
const ELLIPSIS = "…";
/**
 * Rezerwa na wielokropek w jednostkach rozmiaru fontu. Arial (metrycznie
 * zgodny z Helvetica) rysuje „…" na pełnym kwadracie: 1000/1000 em. Tabela
 * `classifyChar` liczy go jako zwykły znak (0,56 em), więc rezerwa jest
 * celowo HOJNIEJSZA od pomiaru - wynik z wielokropkiem zawsze mieści się w
 * budżecie także według `estimateTextWidthPx`.
 */
const ELLIPSIS_RESERVE_EM = 1;

/**
 * Odstęp, na którym WOLNO złamać snippet. Spacje nierozdzielające (NBSP,
 * wąska NBSP, spacja cyfrowa) są celowo poza zbiorem: redakcja stawia je
 * właśnie po to, żeby „10 km" albo „w Polsce" nie rozjechały się na granicy.
 */
const BREAKABLE_SPACE = /[^\S\u00a0\u2007\u202f]/;

/**
 * Interpunkcja, która po ucięciu WISIAŁABY przed wielokropkiem („Europa, …",
 * „Raport - …"). Kropka, znak zapytania i nawias zamykający zostają - kończą
 * pełną jednostkę tekstu („U.S.", „(2027)").
 */
const DANGLING_TAIL = /[\s,;:\-–—|/·•]+$/u;

/**
 * Wielokropek, który redakcja wpisała SAMA („Europa… ", „Co dalej... ").
 * Gdy ucięty fragment już się nim kończy, doklejenie drugiego dałoby
 * „Europa……" - takiego snippetu Google nie pokazuje. Pojedyncza kropka
 * („U.S.") i dwie kropki nie są wielokropkiem.
 */
const AUTHORED_ELLIPSIS = /(?:…|\.{3,})$/u;

/**
 * Truncate a string to a pixel budget with an ellipsis, for the preview.
 *
 * Kontrakt (pilnowany przez `serp.test.ts` i `SerpPreview.test.tsx`):
 *   - napis mieszczący się w budżecie wraca BEZ ZMIAN (bez przycinania odstępów),
 *   - dłuższy napis jest ucinany na OSTATNIEJ granicy słowa, która mieści się
 *     w budżecie RAZEM z wielokropkiem - tak jak urywa go Google; wyraz nie
 *     jest rozrywany w połowie,
 *   - wiszące odstępy i interpunkcja łącząca (przecinek, dwukropek, myślnik)
 *     znikają przed wielokropkiem,
 *   - jedno słowo dłuższe niż cały budżet (URL, ciąg bez spacji) - nie ma się
 *     do czego cofnąć, więc spada na twarde cięcie po znaku,
 *   - ucięty fragment, który już kończy się wielokropkiem („…" albo „..."),
 *     nie dostaje drugiego,
 *   - budżet węższy niż sam wielokropek daje pusty napis, nie „…" ponad limit.
 */
export function truncateToPx(text: string, fontSizePx: number, limitPx: number): string {
  if (estimateTextWidthPx(text, fontSizePx) <= limitPx) return text;
  const budget = limitPx / fontSizePx - ELLIPSIS_RESERVE_EM;
  if (budget <= 0) return "";

  let fitted = "";
  let units = 0;
  /** Długość `fitted` tuż przed ostatnim łamliwym odstępem (-1: brak). */
  let lastBreak = -1;
  /** Pierwszy znak, który już się nie zmieścił. */
  let overflow = "";
  for (const ch of text) {
    units += charWidthFactor(ch);
    if (units > budget) {
      overflow = ch;
      break;
    }
    if (BREAKABLE_SPACE.test(ch)) lastBreak = fitted.length;
    fitted += ch;
  }

  // Cięcie wypadło DOKŁADNIE na granicy słowa (następny znak to odstęp albo
  // `fitted` kończy się odstępem) - całe słowa już są, cofać się nie trzeba.
  const endsOnBoundary = BREAKABLE_SPACE.test(overflow) || BREAKABLE_SPACE.test(fitted.slice(-1));
  const wordCut = endsOnBoundary || lastBreak < 0 ? fitted : fitted.slice(0, lastBreak);
  const kept = wordCut.replace(DANGLING_TAIL, "");
  // Pusto po cofnięciu (np. napis zaczyna się odstępem albo samą interpunkcją
  // przed jednym długim słowem): twarde cięcie po znaku jest lepsze niż sam
  // wielokropek.
  const out = kept || fitted.replace(DANGLING_TAIL, "");
  if (!out) return "";
  // Własny wielokropek redakcji już sygnalizuje ucięcie - drugiego nie dokładamy.
  return AUTHORED_ELLIPSIS.test(out) ? out : `${out}${ELLIPSIS}`;
}
