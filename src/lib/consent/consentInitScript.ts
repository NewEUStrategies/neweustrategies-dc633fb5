// Skrypt inicjalizacji zgód (P1.3): powłoka banera zgód z SSR widoczna od
// pierwszego malowania, a decyzja z niej utrwalana od razu - także przed bootem.
//
// PO CO. Baner zgód był malowany 1-2,5 s po treści (27 pp histogramu ostatniej
// klatki filmstripu mobile, PLAN.md P1.3). Teraz SSR wysyła statyczną powłokę
// kompaktowej karty (`components/consent/ConsentShell.tsx`), a interaktywny
// baner montuje się dopiero po pierwszej interakcji (kolejka P0.3, klasa
// `shell`). Między pierwszym malowaniem a bootem pracuje ten skrypt:
//
//  1. PRZED PIERWSZYM MALOWANIEM (stoi w `<head>` zaraz po `THEME_INIT_SCRIPT`)
//     ustawia `html[data-consent-decided]`, gdy w przeglądarce leży decyzja -
//     powłoka ma wariant Tailwind `[html[data-consent-decided]_&]:hidden`, więc
//     odwiedzający z decyzją NIGDY jej nie widzi (bez `:has()`, bez edycji
//     `styles.css`). Reguła ważności pochodzi z `lib/ads/consent.ts`
//     (`CONSENT_DECIDED_JS`), tam gdzie `safeParse` - jedna reguła, bez kopii.
//
//  2. DELEGOWANY `click` NA `[data-consent-shell] [data-consent-action]`
//     (dokument, faza bąbelkowania). Decyzja (`accept`, `reject`, `close` = odmowa
//     jak „X" banera) ukrywa powłokę od razu i:
//       - po boocie - oddaje decyzję aplikacji zdarzeniem `consent-shell-decision`
//         (anulowalnym); partner skryptu (`startConsentTakeover`, niżej) woła
//         `applyShellDecision`, czyli `setConsent` banera, i anuluje zdarzenie;
//       - przed bootem (nikt nie anulował) - zapisuje rekord serializatorem
//         `CONSENT_WRITE_JS` z `consent.ts` (bajt w bajt jak baner poza
//         znacznikiem czasu), wypycha `gtag('consent','update',…)` jak
//         `ga4ConsentUpdate`, rozgłasza `consent-change` i zostawia znacznik
//         `SHELL_PENDING_KEY` dla `finalizePendingShellDecision()` (profil
//         i rejestr RODO zalogowanego). Nawigacja MPA przed bootem nie gubi więc
//         decyzji (krytyka m4c), a baner na następnej stronie nie wraca.
//     Pozostałe akcje to INTENCJE (`customize`, `lang-pl`, `lang-en`): skrypt
//     zapisuje `html[data-consent-intent]` i rozgłasza `consent-shell-intent` -
//     partner skryptu montuje wtedy baner torem pilnym, a baner odtwarza intencję.
//     Kolejka P0.3 zwalnia się na `pointerdown`, ale ten nasłuch jest niezależny
//     od podmiany drzewa: decyzja nie zależy od tego, czy baner zdążył zastąpić
//     powłokę przed `click` (recenzja P0.3, ustalenie 1).
//
// GPC. Akceptacja przy aktywnym sygnale GPC (`navigator.globalPrivacyControl`
// albo ciasteczko transportowe `nes_gpc=1` - ten sam odczyt co
// `resolveClientGpc`) nie włącza kategorii klamrowanych (`shellDecisionCategories`
// w `consent.ts`): powłoka nie pokazuje noty GPC, więc to nie jest świadomy
// override.
//
// Wszystko w `try` - zablokowany magazyn, ciasteczka w ramce z piaskownicą albo
// stary silnik zostawiają powłokę widoczną i baner do obsłużenia po boocie
// (= zachowanie sprzed P1.3, tylko z wcześniejszym malowaniem).
//
// PARTNER SKRYPTU PO BOOCIE (`startConsentTakeover` na dole pliku): odbiera
// zdarzenia skryptu (decyzja, intencja), domyka decyzję sprzed bootu, zgłasza
// stan powłoki koordynatorowi nakładek i planuje montaż interaktywnego banera
// (kolejka P0.3, tor pilny, punkt ciszy). Mieszka TU, a nie w `__root.tsx`, bo
// w przeglądarce ten moduł jest LENIWY: korzeń dociąga go `import()` po
// hydratacji, a jedyny statyczny import (stała skryptu w `RootShell`) stoi w
// gałęzi `.server()` `createIsomorphicFn`, którą kompilator Start wycina z
// bundla klienta. Tekst skryptu, fragmenty z `consent.ts`, prymitywy P0.3 i
// koordynator nie wchodzą więc do zamknięcia bootu (zmierzone: ~2,3 KB gzip
// w wersji z kodem w korzeniu, PLAN §2: przyrost > 1 KB wymaga uzasadnienia).
import {
  CONSENT_CHANGE_EVENT,
  CONSENT_DECIDED_JS,
  CONSENT_READ_JS,
  CONSENT_WRITE_JS,
  OPEN_PREFS_EVENT,
  SHELL_PENDING_KEY,
  applyShellDecision,
  finalizePendingShellDecision,
  readConsentOverlayReport,
  subscribeConsentChange,
} from "@/lib/ads/consent";
import { GPC_COOKIE, GPC_COOKIE_VALUE } from "@/lib/consent/gpc";
import { reportConsentSurface } from "@/lib/overlayCoordinator";
import { enqueue, type CancelQueuedTask } from "@/lib/performance/postInteractionQueue";
import { onQuiescent } from "@/lib/performance/whenQuiescent";

/** Atrybut na `<html>`: w przeglądarce leży decyzja (powłoka ukryta). */
export const CONSENT_DECIDED_ATTR = "data-consent-decided";
/** Atrybut na `<html>`: intencja klikniętą w powłoce przed bootem (np. `customize`). */
export const CONSENT_INTENT_ATTR = "data-consent-intent";
/** Atrybut korzenia powłoki - zakres delegowanego `click`. */
export const CONSENT_SHELL_ATTR = "data-consent-shell";
/** Atrybut kontrolki powłoki i banera: ta sama akcja = ta sama kontrolka (fokus przy podmianie). */
export const CONSENT_ACTION_ATTR = "data-consent-action";
/** Zdarzenie okna: decyzja z powłoki (anulowalne - anulowanie = „aplikacja obsłużyła"). */
export const CONSENT_SHELL_DECISION_EVENT = "consent-shell-decision";
/** Zdarzenie okna: intencja z powłoki (montaż banera torem pilnym). */
export const CONSENT_SHELL_INTENT_EVENT = "consent-shell-intent";

/** Akcje kontrolek kompaktowej karty (powłoka i baner). */
export type ConsentShellAction =
  "accept" | "reject" | "close" | "customize" | "lang-pl" | "lang-en";

const NOT_A_DECISION = "x!=='accept'&&x!=='reject'&&x!=='close'";

/**
 * Sygnał GPC w chwili kliknięcia - ten sam warunek co `resolveClientGpc`:
 * `navigator.globalPrivacyControl === true` albo napis `"1"` (po `trim`), albo
 * ciasteczko `nes_gpc` o wartości `"1"` po zdekodowaniu (`readGpcCookie`).
 */
const GPC_JS =
  `var n=navigator.globalPrivacyControl,g=n===!0||(typeof n==='string'&&n.trim()==='${GPC_COOKIE_VALUE}')||` +
  `document.cookie.split(';').some(function(p){var i=p.indexOf('=');if(i<0||p.slice(0,i).trim()!=='${GPC_COOKIE}')return;` +
  `try{return decodeURIComponent(p.slice(i+1).trim()).trim()==='${GPC_COOKIE_VALUE}'}catch(e){}});`;

/**
 * Consent Mode po decyzji - te same pola, kolejność i wartości co
 * `ga4ConsentUpdate` (`lib/analytics/ga4Client.ts`); parytet sprawdza test.
 * `window.gtag` istnieje tylko wtedy, gdy snippet SSR przeszedł bramkę hosta -
 * ta sama warunkowość co w `ga4Client.gtag`.
 */
const CONSENT_MODE_JS =
  `var G=w.gtag,d=function(v){return v?'granted':'denied'};` +
  `if(typeof G==='function')G('consent','update',{ad_storage:d(z),ad_user_data:d(z),ad_personalization:d(z),analytics_storage:d(z),functionality_storage:d(y),personalization_storage:d(y),security_storage:'granted'});`;

/**
 * Treść skryptu. IIFE w jednej linii - wstrzykiwana inline do `<head>`, więc
 * każdy znak to bajt na krytycznej ścieżce (osobny commit z pomiarem
 * `check-document-weight`). Zmienne: `r` - `<html>`, `w` - `window`, `x` -
 * akcja, `y` - akceptacja (functional), `z` - akceptacja kategorii
 * klamrowanych przez GPC (analytics, marketing).
 */
export const CONSENT_INIT_SCRIPT =
  `(function(){try{${CONSENT_READ_JS}var r=document.documentElement,w=window;` +
  `if(${CONSENT_DECIDED_JS})r.setAttribute('${CONSENT_DECIDED_ATTR}','');` +
  `document.addEventListener('click',function(e){try{` +
  `var t=e.target,b=t&&t.closest?t.closest('[${CONSENT_SHELL_ATTR}] [${CONSENT_ACTION_ATTR}]'):null;if(!b)return;` +
  `var x=b.getAttribute('${CONSENT_ACTION_ATTR}');` +
  `if(${NOT_A_DECISION}){r.setAttribute('${CONSENT_INTENT_ATTR}',x);w.dispatchEvent(new CustomEvent('${CONSENT_SHELL_INTENT_EVENT}',{detail:x}));return}` +
  `r.setAttribute('${CONSENT_DECIDED_ATTR}','');` +
  `if(!w.dispatchEvent(new CustomEvent('${CONSENT_SHELL_DECISION_EVENT}',{detail:x,cancelable:!0})))return;` +
  `${GPC_JS}var y=x==='accept',z=y&&!g;${CONSENT_WRITE_JS}W(y,z,z);` +
  `try{localStorage.setItem('${SHELL_PENDING_KEY}','1')}catch(e){}` +
  `${CONSENT_MODE_JS}w.dispatchEvent(new Event('${CONSENT_CHANGE_EVENT}'))` +
  `}catch(e){}})}catch(e){}})();`;

/** Akcja kontrolki z atrybutu/zdarzenia albo `null`, gdy to nie jest znana akcja. */
export function parseShellAction(value: string | null | undefined): ConsentShellAction | null {
  switch (value) {
    case "accept":
    case "reject":
    case "close":
    case "customize":
    case "lang-pl":
    case "lang-en":
      return value;
    default:
      return null;
  }
}

/** Czy akcja z powłoki jest decyzją (a nie intencją dla banera). */
export function isShellDecision(action: string): action is "accept" | "reject" | "close" {
  return action === "accept" || action === "reject" || action === "close";
}

// ---------- Partner skryptu po boocie (P1.3) ----------

/** Przejęcie powłoki przekazywane banerowi (`ConsentBannerTakeover`). */
export interface ConsentTakeover {
  /** Intencja kliknięta w powłoce (`customize`, `lang-*`) - baner ją odtwarza. */
  intent: ConsentShellAction | null;
  /** Akcja kontrolki powłoki z fokusem - fokus przechodzi na tę samą kontrolkę banera. */
  focus: ConsentShellAction | null;
}

export interface ConsentTakeoverHost {
  /**
   * Montuje interaktywny baner w miejsce powłoki (jeden commit). Promise
   * rozstrzyga się PO commicie banera - KONTRAKT ZADANIA kolejki P0.3
   * („P1.3 - po montażu banera"), więc kolejka nie nakłada na montaż kolejnej
   * pracy.
   */
  mount: (takeover: ConsentTakeover) => Promise<void>;
  /** Gniazdo powłoki - cel promocji w kolejce (pierwsza interakcja w powłoce). */
  slot: Element | null;
}

/** Akcja kontrolki powłoki, która ma teraz fokus. */
function focusedShellAction(): ConsentShellAction | null {
  const active = document.activeElement;
  const control = active?.closest?.(`[${CONSENT_SHELL_ATTR}] [${CONSENT_ACTION_ATTR}]`);
  return parseShellAction(control?.getAttribute(CONSENT_ACTION_ATTR));
}

/**
 * Uruchamia partnera skryptu inline po hydratacji. Zwraca sprzątanie (cleanup
 * efektu korzenia). Kolejność kroków jest częścią kontraktu:
 *  1. nasłuch decyzji z powłoki - od teraz decyzję zapisuje `applyShellDecision`
 *     (droga banera), a skrypt inline widzi anulowane zdarzenie;
 *  2. domknięcie decyzji klikniętej PRZED tym momentem (znacznik
 *     `SHELL_PENDING_KEY`) i intencji czekającej w `html[data-consent-intent]`;
 *  3. stan powłoki dla koordynatora nakładek (do montażu banera, potem pisze
 *     baner): brak decyzji = powłoka widoczna = brama zamknięta;
 *  4. montaż banera: pierwsza interakcja (kolejka, klasa `shell`, cel = gniazdo;
 *     strażnik gestu trzyma krok do `click`), intencja z powłoki albo
 *     `requestConsentPreferences()` - tor pilny (start importu w pierwszym
 *     mikrozadaniu), w ostateczności punkt ciszy.
 */
export function startConsentTakeover({ mount, slot }: ConsentTakeoverHost): () => void {
  if (typeof window === "undefined") return () => {};
  const html = document.documentElement;
  let active = true;
  let intent: ConsentShellAction | null = null;
  let started: Promise<void> | null = null;
  let stopReporting: () => void = () => {};
  const cancels: CancelQueuedTask[] = [];

  const takeIntent = () => {
    const pending = parseShellAction(html.getAttribute(CONSENT_INTENT_ATTR));
    html.removeAttribute(CONSENT_INTENT_ATTR);
    if (pending && !isShellDecision(pending)) intent = pending;
  };

  // Montaż raz. Intencję i fokus czytamy w chwili montażu - intencja kliknięta,
  // gdy import banera był już w drodze, nie przepada.
  const mountOnce = (): Promise<void> => {
    started ??= Promise.resolve().then(() => {
      if (!active) return;
      stopReporting();
      stopReporting = () => {};
      return mount({ intent, focus: focusedShellAction() });
    });
    return started;
  };
  const mountUrgently = () => {
    cancels.push(enqueue(mountOnce, { priority: "shell", release: "urgent" }));
  };

  const onDecision = (event: Event) => {
    const action = event instanceof CustomEvent ? parseShellAction(String(event.detail)) : null;
    if (!action || !isShellDecision(action)) return;
    applyShellDecision(action);
    event.preventDefault();
  };
  const onIntent = () => {
    takeIntent();
    mountUrgently();
  };
  window.addEventListener(CONSENT_SHELL_DECISION_EVENT, onDecision);
  window.addEventListener(CONSENT_SHELL_INTENT_EVENT, onIntent);
  window.addEventListener(OPEN_PREFS_EVENT, mountUrgently);

  finalizePendingShellDecision();
  if (html.hasAttribute(CONSENT_INTENT_ATTR)) onIntent();

  // Do montażu banera (`mountOnce` zdejmuje ten nasłuch tuż przed montażem).
  const report = () => {
    const { decided, marketing } = readConsentOverlayReport();
    reportConsentSurface(!decided, marketing);
    html.toggleAttribute(CONSENT_DECIDED_ATTR, decided);
  };
  report();
  stopReporting = subscribeConsentChange(report);

  cancels.push(enqueue(mountOnce, { priority: "shell", target: slot }));
  cancels.push(onQuiescent(mountOnce, { priority: "shell" }));

  return () => {
    active = false;
    window.removeEventListener(CONSENT_SHELL_DECISION_EVENT, onDecision);
    window.removeEventListener(CONSENT_SHELL_INTENT_EVENT, onIntent);
    window.removeEventListener(OPEN_PREFS_EVENT, mountUrgently);
    for (const cancel of cancels) cancel();
    stopReporting();
  };
}
