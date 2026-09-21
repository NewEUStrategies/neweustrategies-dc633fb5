// Global coordinator for marketing overlays (newsletter popup, builder
// popups, footer slide-up). Previously each overlay system triggered
// independently, so a first visit could stack the consent banner + newsletter
// popup + a builder popup at once. Rules enforced here:
//
//   1. While the consent banner is deciding (visible), NO overlay may open -
//      consent always goes first (hard gate on the whole queue).
//   2. Only ONE overlay may be open at a time (single owner).
//   3. After an overlay is granted, subsequent grants wait out a short in-memory
//      cooldown, so overlays never chain back-to-back on the same page view.
//   4. Among waiting requests the highest `priority` wins (FIFO within a
//      priority), so e.g. a targeted builder popup can outrank the generic
//      newsletter popup instead of relying on arrival order.
//   5. Marketing overlays (`marketing: true`) are additionally:
//        - SUPPRESSED entirely when the visitor has explicitly rejected
//          marketing consent (not merely reordered - see setMarketingConsent),
//        - counted against a PERSISTED, cross-session interruption budget
//          (max N per calendar day, min gap between two overlays) so a reload
//          or a new tab can't immediately re-show an overlay,
//        - WSTRZYMANE do czasu, aż baner zgód w ogóle ZGŁOSI swój stan
//          (patrz `consentReported`) - inaczej nakładka wchodziła przed
//          pierwszym kontaktem odwiedzającego z banerem.
//
// Non-marketing dialogs (login popup - user-initiated, app dialogs) do not
// participate: they respond to explicit user action. Non-marketing coordinated
// entries (used by tests) skip consent-suppression and the persisted budget.

type Entry = {
  id: string;
  priority: number;
  marketing: boolean;
  resolve: (release: () => void) => void;
};

const COOLDOWN_MS = 30_000;

// Persisted, cross-session interruption budget for marketing overlays.
const BUDGET_KEY = "overlay:budget:v1";
const MAX_MARKETING_PER_DAY = 3;
const MIN_MARKETING_GAP_MS = 20 * 60_000; // 20 minutes between marketing overlays

type Budget = { day: string; count: number; lastTs: number };

let consentVisible = false;
// null = brak decyzji albo brak wiedzy; true = zgoda; false = wyraźna odmowa
// -> nakładki marketingowe są wygaszone. UWAGA: samo `null` NIE jest bezpieczne
// - przed pierwszym zgłoszeniem baneru znaczy „jeszcze nie zapytaliśmy", a nie
// „odwiedzający nie zdecydował". Bramę trzyma dlatego osobna flaga niżej.
let marketingConsent: boolean | null = null;
// Czy baner zgód ZGŁOSIŁ JUŻ swój stan (przez `setConsentOverlayVisible(true)`
// albo `setMarketingConsent`). Stan początkowy = niezgłoszony, bo tak wygląda
// moduł tuż po załadowaniu strony: baner jest leniwym chunkiem montowanym
// z opóźnieniem (`__root`: rAF + bezczynność), a nakładki marketingowe planują
// się niezależnie od niego. W tym oknie `consentVisible === false` plus
// `marketingConsent === null` wyglądały jak „baner nie przeszkadza, decyzji
// brak" i popup buildera z wyzwalaczem „immediate" potrafił zająć slot, zanim
// odwiedzający pierwszy raz zobaczył baner - tym łatwiej, im wolniej schodził
// większy chunk zgód (recenzja Codex, PR #382).
//
// ZAKRES: brama obejmuje WYŁĄCZNIE wpisy `marketing: true`, nie całą kolejkę.
// Reguła 1 z nagłówka mówi o banerze WIDOCZNYM (kolizja na ekranie plus
// pierwszeństwo zgody), a „jeszcze nie zgłosił" to stan niewiedzy, nie
// widoczności. Wpisy niemarketingowe z definicji nie zależą od zgody (patrz
// `pickIndex`), więc ich wstrzymanie niczego by nie chroniło, a zamieniałoby
// brak baneru w trwałe zakleszczenie obietnicy, której nikt nie rozwiąże.
//
// FAIL-CLOSED, ŚWIADOMIE: gdyby baner NIGDY nie zgłosił stanu (nie wczyta się
// jego chunk, wyjątek w komponencie, drzewo bez baneru), żadna nakładka
// marketingowa nie otworzy się do końca życia strony. Kierunek awarii jest
// właściwy - ceną jest utracona przerwa reklamowa, a nie pokazanie jej bez
// zapytania o zgodę. W przeglądarce ścieżka zgłoszenia jest bezwarunkowa:
// efekt w `ConsentBanner` stoi wprawdzie za `if (!mounted) return`, ale
// `mounted` przestawia się w `useEffect` przy KAŻDYM montażu, niezależnie od
// tego, czy baner cokolwiek rysuje (wyłączony w ustawieniach, strona admina,
// iframe podglądu) - efekt zgłaszający poprzedza wszystkie wczesne `return`
// renderu.
let consentReported = false;
let owner: string | null = null;
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Entry[] = [];

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function readBudget(): Budget {
  if (typeof window === "undefined") return { day: "", count: 0, lastTs: 0 };
  try {
    const raw = window.localStorage.getItem(BUDGET_KEY);
    if (!raw) return { day: "", count: 0, lastTs: 0 };
    const v = JSON.parse(raw) as Partial<Budget>;
    return {
      day: typeof v.day === "string" ? v.day : "",
      count: typeof v.count === "number" ? v.count : 0,
      lastTs: typeof v.lastTs === "number" ? v.lastTs : 0,
    };
  } catch {
    return { day: "", count: 0, lastTs: 0 };
  }
}

function writeBudget(b: Budget): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BUDGET_KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable - budget degrades to in-memory only */
  }
}

/** Whether a marketing overlay may be granted now under the persisted budget. */
function marketingBudgetAllows(now: number): boolean {
  const b = readBudget();
  const today = dayKey(now);
  const countToday = b.day === today ? b.count : 0;
  if (countToday >= MAX_MARKETING_PER_DAY) return false;
  if (b.lastTs > 0 && now - b.lastTs < MIN_MARKETING_GAP_MS) return false;
  return true;
}

function recordMarketingGrant(now: number): void {
  const b = readBudget();
  const today = dayKey(now);
  const countToday = b.day === today ? b.count : 0;
  writeBudget({ day: today, count: countToday + 1, lastTs: now });
}

/** True if a marketing entry is currently blocked (consent denied or budget). */
function marketingBlocked(now: number): boolean {
  // Dopóki baner nie zgłosił stanu, o zgodzie nie wiemy NIC - patrz `consentReported`.
  if (!consentReported) return true;
  return marketingConsent === false || !marketingBudgetAllows(now);
}

/** Index of the highest-priority grantable waiter (FIFO within a priority). */
function pickIndex(now: number): number {
  let best = -1;
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (e.marketing && marketingBlocked(now)) continue;
    if (e.priority > bestPriority) {
      best = i;
      bestPriority = e.priority;
    }
  }
  return best;
}

function pump(): void {
  if (owner || consentVisible || queue.length === 0) return;
  const now = Date.now();
  if (now < cooldownUntil) {
    // Re-pump when the cooldown lapses (timer deduped).
    if (!cooldownTimer) {
      cooldownTimer = setTimeout(
        () => {
          cooldownTimer = null;
          pump();
        },
        Math.max(50, cooldownUntil - now),
      );
    }
    return;
  }
  const idx = pickIndex(now);
  if (idx < 0) return;
  const [next] = queue.splice(idx, 1);
  owner = next.id;
  cooldownUntil = Date.now() + COOLDOWN_MS;
  if (next.marketing) recordMarketingGrant(now);
  next.resolve(() => {
    if (owner === next.id) {
      owner = null;
      cooldownUntil = Date.now() + COOLDOWN_MS;
      pump();
    }
  });
}

/** ConsentBanner reports its initial-banner visibility here. */
export function setConsentOverlayVisible(visible: boolean): void {
  // Zgłoszeniem stanu jest tylko `true`: z `false` woła także sprzątanie przy
  // ODMONTOWANIU baneru (również to z podwójnego montażu w StrictMode), a
  // odmontowanie nie jest odpowiedzią na pytanie o zgodę - zdjęcie bramy
  // `consentReported` w tym miejscu otwierałoby ją w oknie, w którym baner
  // jeszcze niczego nie zdążył opublikować.
  if (visible) consentReported = true;
  consentVisible = visible;
  if (!visible) pump();
}

/**
 * ConsentBanner reports the resolved marketing-consent decision here.
 * `null` = undecided, `true` = granted, `false` = explicitly denied. When
 * denied, marketing overlays are suppressed outright (not just reordered).
 */
export function setMarketingConsent(value: boolean | null): void {
  // KAŻDE wywołanie - także z `null` - jest zgłoszeniem stanu: znaczy „baner
  // żyje i tyle wie o zgodzie". Dopiero ono zdejmuje bramę `consentReported`.
  consentReported = true;
  marketingConsent = value;
  if (value !== false) pump();
}

export type OverlaySlotOptions = {
  /** Higher wins when several requests wait. Default 0. */
  priority?: number;
  /**
   * Marketing overlays are consent-suppressed and counted against the
   * persisted cross-session interruption budget. Default false.
   */
  marketing?: boolean;
};

/**
 * Request permission to open an overlay. Resolves with a `release` function
 * once the slot is granted (may be deferred behind the consent banner /
 * another overlay / the cooldown / the marketing budget). Call `release()`
 * when the overlay closes. Cancel a still-pending request with
 * `cancelOverlayRequest(id)`.
 */
export function requestOverlaySlot(id: string, opts: OverlaySlotOptions = {}): Promise<() => void> {
  return new Promise((resolve) => {
    queue.push({
      id,
      priority: opts.priority ?? 0,
      marketing: opts.marketing ?? false,
      resolve,
    });
    pump();
  });
}

/** Remove a not-yet-granted request (e.g. the requesting component unmounted). */
export function cancelOverlayRequest(id: string): void {
  const idx = queue.findIndex((e) => e.id === id);
  if (idx >= 0) queue.splice(idx, 1);
}

/** True while a coordinated overlay currently holds the single slot. */
export function isOverlayActive(): boolean {
  return owner !== null;
}

/** Test-only: reset module state between test cases. */
export function __resetOverlayCoordinator(): void {
  consentVisible = false;
  marketingConsent = null;
  // Prawdziwy stan początkowy to „baner jeszcze nie zgłosił stanu" - test,
  // który resetuje koordynator, musi startować z zamkniętą bramą.
  consentReported = false;
  owner = null;
  cooldownUntil = 0;
  queue.length = 0;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(BUDGET_KEY);
    } catch {
      /* ignore */
    }
  }
}
