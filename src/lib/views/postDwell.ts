// Pomiar czasu AKTYWNEGO czytania wpisu - źródło sygnału dwell silnika
// rekomendacji (`related_posts_dwell`, migracja 20261002120000).
//
// CO MIERZYMY. Czas, w którym karta jest widoczna, a czytelnik był aktywny
// (przewinięcie strony, klawisz, dotyk, ruch wskaźnika) nie dawniej niż
// `DWELL_IDLE_CUTOFF_MS` temu. Każda przerwa między zdarzeniami liczy się
// najwyżej do tego progu: czytanie jednego ekranu bez dotykania myszy zostaje
// policzone, karta zostawiona na noc - nie. Karta otwarta w tle (Ctrl+klik) nie
// nabija niczego, dopóki nie stanie się widoczna.
//
// KIEDY I CO WYSYŁAMY. Przy każdym schowaniu karty, przy `pagehide` i przy
// odmontowaniu (nawigacja SPA do innego wpisu) - NARASTAJĄCĄ sumę, i tylko gdy
// urosła. Baza przyjmuje wyłącznie wartość większą od zapisanej (GREATEST), więc
// powtórzony beacon i kolejne zgłoszenia są idempotentne, a czas po powrocie do
// karty nie przepada.
//
// PRYWATNOŚĆ. Moduł startuje WYŁĄCZNIE dla odsłony, którą `useRecordPostView`
// już policzył pod zgodą analityczną, i zgłasza ją tym samym `viewer_hash`, pod
// którym ta odsłona leży w `post_views` - żadnego nowego identyfikatora ani
// klucza w magazynie przeglądarki. Zgodę czytamy JESZCZE RAZ przy wysyłce,
// a jej wycofanie w trakcie czytania kończy pomiar od razu i bez wysyłki.
//
// ŁADOWANY LENIWIE (`import()` w `useRecordPostView`): hook siedzi w chunku
// wejściowym trasy wpisu, a ten stoi tuż pod progiem `check:bundle`. Pomiar
// rusza po policzeniu odsłony, więc dociągnięcie kodu nic nie spóźnia.
import { hasAnalyticsConsent, subscribeConsentChange } from "@/lib/ads/consent";
import { sendBeaconPayload } from "@/lib/observability/report";
import {
  DWELL_MAX_MS,
  DWELL_MIN_MS,
  POST_DWELL_ENDPOINT,
  type PostDwellPayload,
} from "@/lib/views/postDwellWire";

/** Najdłuższa przerwa między zdarzeniami, która jeszcze liczy się jako czytanie. */
export const DWELL_IDLE_CUTOFF_MS = 30_000;

/**
 * Zdarzenia WEJŚCIA czytelnika - łapane w fazie capture na `window`, więc
 * dochodzą z każdego elementu strony.
 *
 * `scroll` CELOWO NIE MA NA TEJ LIŚCIE. Przewinięcie elementu nie bąbelkuje,
 * ale słuchacz capture na `window` i tak je dostaje - także przewinięcie, którego
 * nie zrobił człowiek: karuzela z autoodtwarzaniem (`PostListCarousel`
 * woła `scrollTo` co kilka sekund) albo `scrollIntoView` slidera. Taka karta
 * zostawiona na pierwszym planie nigdy nie przekroczyłaby progu bezczynności
 * i nabijałaby czas aż do sufitu. Przewinięcie STRONY łapie osobny słuchacz
 * bez capture (niżej) - dostaje wyłącznie bąbelkujący `scroll` dokumentu.
 */
const INPUT_EVENTS = ["wheel", "keydown", "pointerdown", "pointermove", "touchstart"];

/** Granice świata przeglądarki - wstrzykiwane, żeby test nie potrzebował zegara ani DOM-u. */
export interface PostDwellDeps {
  now: () => number;
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  hasConsent: () => boolean;
  /** Sygnał „zgoda się zmieniła" (baner, inna karta, GPC); zwraca odpięcie. */
  onConsentChange: (listener: () => void) => () => void;
  send: (payload: PostDwellPayload) => void;
}

function sendDwell(payload: PostDwellPayload): void {
  if (sendBeaconPayload(POST_DWELL_ENDPOINT, payload)) return;
  // Bez `sendBeacon` (albo gdy kolejka beaconów jest pełna) - keepalive fetch,
  // jak w `relatedClickBeacon`. Odpowiedź nie ma znaczenia.
  void fetch(POST_DWELL_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => undefined);
}

function browserDeps(): PostDwellDeps {
  return {
    now: () => performance.now(),
    doc: document,
    win: window,
    hasConsent: hasAnalyticsConsent,
    onConsentChange: subscribeConsentChange,
    send: sendDwell,
  };
}

/**
 * Rusza pomiar dla policzonej odsłony. Zwraca funkcję, która domyka bieżący
 * odcinek, wysyła narastającą sumę i odpina nasłuch - wołaną przy odmontowaniu.
 * Wielokrotne wywołanie jest bezpieczne.
 */
export function startPostDwell(
  postId: string,
  viewerHash: string,
  deps: PostDwellDeps = browserDeps(),
): () => void {
  let engaged = 0;
  let reported = 0;
  let last: number | null = deps.doc.visibilityState === "visible" ? deps.now() : null;
  let stopped = false;

  const closeSegment = (): void => {
    if (last === null) return;
    engaged += Math.min(Math.max(deps.now() - last, 0), DWELL_IDLE_CUTOFF_MS);
    last = null;
  };

  const flush = (): void => {
    const dwellMs = Math.min(Math.round(engaged), DWELL_MAX_MS);
    if (dwellMs < DWELL_MIN_MS || dwellMs <= reported || !deps.hasConsent()) return;
    reported = dwellMs;
    deps.send({ postId, viewerHash, dwellMs });
  };

  const onActivity = (): void => {
    if (deps.doc.visibilityState !== "visible") return;
    closeSegment();
    last = deps.now();
  };

  const onVisibility = (): void => {
    if (deps.doc.visibilityState === "visible") {
      last = deps.now();
      return;
    }
    closeSegment();
    flush();
  };

  const onPageHide = (): void => {
    closeSegment();
    flush();
  };

  const input = { capture: true, passive: true } as const;
  const pageScroll = { passive: true } as const;

  const detach = (): void => {
    stopped = true;
    for (const type of INPUT_EVENTS) deps.win.removeEventListener(type, onActivity, input);
    deps.win.removeEventListener("scroll", onActivity, pageScroll);
    deps.doc.removeEventListener("visibilitychange", onVisibility);
    deps.win.removeEventListener("pagehide", onPageHide, { capture: true });
    offConsent();
  };

  // WYCOFANIE ZGODY KOŃCZY POMIAR OD RAZU I BEZ WYSYŁKI. Samo sprawdzenie
  // w `flush` nie wystarcza: czas liczony dalej po wycofaniu poleciałby pod
  // starym `viewer_hash`, gdyby czytelnik jeszcze na tej stronie udzielił
  // zgody ponownie - pomiar okresu, na który zgody nie było.
  const onConsent = (): void => {
    if (stopped || deps.hasConsent()) return;
    detach();
    engaged = 0;
    last = null;
  };

  for (const type of INPUT_EVENTS) deps.win.addEventListener(type, onActivity, input);
  deps.win.addEventListener("scroll", onActivity, pageScroll);
  deps.doc.addEventListener("visibilitychange", onVisibility);
  deps.win.addEventListener("pagehide", onPageHide, { capture: true });
  // `detach` woła `offConsent` dopiero po tym przypisaniu - nigdy wcześniej.
  const offConsent = deps.onConsentChange(onConsent);

  return () => {
    if (stopped) return;
    detach();
    closeSegment();
    flush();
  };
}
