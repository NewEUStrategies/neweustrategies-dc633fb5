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
// ODSŁONIĘCIE PO DOMKNIĘCIU W PARSERZE (P1.3b). Powłoka leży w HTML-u za
// stopką (ok. 200 KB od początku dokumentu, w jednej długiej linii), a jest
// `fixed` i zakotwiczona od DOŁU. Gdy parser odda wątek w jej środku, klatka
// maluje uciętą kartę, a dopisanie reszty powiększa ją w górę - przesunięcie
// układu (bramka fali 1, kryterium (d): CLS 0,066 i 0,039 na mobile, 0,016 na
// desktopie). Dlatego karta jest ukryta, dopóki statyczny skrypt
// `CONSENT_SHELL_REVEAL_SCRIPT` (niżej), stojący w gnieździe TUŻ ZA nią, nie
// ustawi `html[data-consent-parsed]`: parser wykonuje go dopiero po wstawieniu
// całej karty, więc ucięta karta nigdy się nie maluje, a pojawienie się
// gotowej nie jest przesunięciem (Layout Instability liczy ruch węzłów
// widocznych w poprzedniej klatce).
//
// PARTNER SKRYPTU PO BOOCIE (`startConsentTakeover` na dole pliku): odbiera
// zdarzenia skryptu (decyzja, intencja), domyka decyzję sprzed bootu, zgłasza
// stan powłoki koordynatorowi nakładek i planuje montaż interaktywnego banera
// (kolejka P0.3, tor pilny, punkt ciszy). Mieszka TU, a nie w `__root.tsx`, bo
// w przeglądarce ten moduł jest LENIWY: korzeń dociąga go `import()` po
// hydratacji, a jedyny statyczny import (stała skryptu w `RootShell`) stoi w
// gałęzi `.server()` `createIsomorphicFn`, którą kompilator Start wycina z
// bundla klienta. Prymitywy P0.3 i koordynator nie wchodzą więc do zamknięcia
// bootu (zmierzone: ~2,3 KB gzip w wersji z kodem w korzeniu, PLAN §2:
// przyrost > 1 KB wymaga uzasadnienia). Tekst skryptu i fragmenty z
// `consent.ts` (moduł w zamknięciu bootu) wycina z klienta dopiero czyste
// wywołanie `buildConsentInitScript` niżej - bez niego martwy szablon trzymał
// fragmenty w chunku wejściowym (dowód P1.3, §2.2).
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
import type { QueryClient } from "@tanstack/react-query";
import { GPC_COOKIE, GPC_COOKIE_VALUE } from "@/lib/consent/gpc";
import { reportConsentSurface } from "@/lib/overlayCoordinator";
import { enqueue } from "@/lib/performance/postInteractionQueue";
import { onQuiescent } from "@/lib/performance/whenQuiescent";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

/** Wspólny przedrostek atrybutów `<html>` ustawianych przez skrypt (bajty skryptu). */
const ATTR = "data-consent-";
/** Atrybut na `<html>`: w przeglądarce leży decyzja (powłoka ukryta). */
export const CONSENT_DECIDED_ATTR = `${ATTR}decided`;
/**
 * Atrybut na `<html>`: aktywny sygnał GPC (powłoka ukryta). Karta banera przy
 * GPC ma notę, której powłoka nie ma (recenzja P1.3, D3): przejęcie powłoki
 * przez baner zmieniałoby geometrię elementu `fixed`, a „Akceptuj wszystkie"
 * w powłoce znaczyłoby co innego niż w banerze. Odwiedzający z GPC dostaje
 * więc od razu po boocie interaktywny baner z notą (`startConsentTakeover`).
 */
export const CONSENT_GPC_ATTR = `${ATTR}gpc`;
/**
 * Atrybut na `<html>`: skrypt rozstrzygnął stan i nasłuchuje kliknięć - BEZ
 * niego powłoka jest ukryta (recenzja P1.3, D2). Bez JavaScriptu (albo gdy
 * skrypt nie zadziałał) nie ma więc martwej karty bez działających przycisków;
 * migotania nie ma, bo skrypt stoi w `<head>`, przed powłoką.
 */
export const CONSENT_JS_ATTR = `${ATTR}js`;
/**
 * Atrybut na `<html>`: parser domknął gniazdo powłoki (P1.3b) - ustawia go
 * `CONSENT_SHELL_REVEAL_SCRIPT`, stojący w gnieździe za kartą. BEZ niego powłoka
 * jest ukryta, więc klatka malowana w trakcie parsowania karty nie pokazuje
 * jej uciętej wersji (nagłówek pliku, „ODSŁONIĘCIE PO DOMKNIĘCIU W PARSERZE").
 * Atrybut stoi także wtedy, gdy baner jest wyłączony (gniazdo bez karty) -
 * znaczy „parser minął gniazdo", nie „karta jest w DOM-ie".
 */
export const CONSENT_PARSED_ATTR = `${ATTR}parsed`;
/** Atrybut na `<html>`: intencja kliknięta w powłoce przed bootem (np. `customize`). */
export const CONSENT_INTENT_ATTR = `${ATTR}intent`;
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

/** Wywołanie `A(…)` skryptu dla atrybutu `<html>` (przedrostek dokleja `A`). */
const setAttr = (attr: string, value = ""): string =>
  `A('${attr.slice(ATTR.length)}'${value ? `,${value}` : ""})`;

/**
 * Składa treść skryptu (`CONSENT_INIT_SCRIPT` niżej). Funkcja, a nie literał na
 * poziomie modułu, bo w przeglądarce ten moduł jest leniwym partnerem skryptu
 * i stałej nikt tam nie czyta (serwer ma ją z gałęzi `.server()` korzenia).
 * Szablon z interpolacjami importów Rollup uznaje za wyrażenie z efektami
 * (`ToString`), więc nieużywana stała zostawała w bundlu klienta jako martwe
 * wyrażenie i trzymała przy życiu fragmenty `CONSENT_READ_JS`/
 * `CONSENT_DECIDED_JS`/`CONSENT_WRITE_JS` w chunku wejściowym (`consent.ts`
 * leży w zamknięciu bootu) - dowód P1.3, §2.2: ok. 268 B gzip bootu. Wywołanie
 * z adnotacją `@__PURE__` Rollup wycina razem z całym tekstem.
 */
function buildConsentInitScript(): string {
  /**
   * Sygnał GPC - ten sam warunek co `resolveClientGpc`: `navigator.globalPrivacyControl
   * === true` albo napis `"1"` (po `trim`), albo KTÓREKOLWIEK ciasteczko `nes_gpc`
   * o wartości `"1"` po zdekodowaniu (`readGpcCookie`; wyjątek dekodowania = brak
   * sygnału z tej części). Liczony RAZ, przed pierwszym malowaniem: steruje
   * widocznością powłoki i klamrą decyzji z powłoki.
   */
  const gpcJs =
    `N=navigator.globalPrivacyControl,g=N===!0||(typeof N=='string'&&N.trim()=='${GPC_COOKIE_VALUE}')||` +
    `document.cookie.split(';').some(function(p){var i=p.indexOf('=');if(i<0||p.slice(0,i).trim()!='${GPC_COOKIE}')return;` +
    `try{return decodeURIComponent(p.slice(i+1).trim()).trim()=='${GPC_COOKIE_VALUE}'}catch(e){}});`;

  /**
   * Consent Mode po decyzji - te same pola, kolejność i wartości co
   * `ga4ConsentUpdate` (`lib/analytics/ga4Client.ts`); parytet sprawdza test.
   * `window.gtag` istnieje tylko wtedy, gdy snippet SSR przeszedł bramkę hosta -
   * ta sama warunkowość co w `ga4Client.gtag`. `Z` - wartość kategorii
   * klamrowanych (analytics, marketing), `Y` - functional.
   */
  const consentModeJs =
    `var G=w.gtag,Z=z?'granted':'denied',Y=y?'granted':'denied';` +
    `if(typeof G=='function')G('consent','update',{ad_storage:Z,ad_user_data:Z,ad_personalization:Z,analytics_storage:Z,functionality_storage:Y,personalization_storage:Y,security_storage:'granted'});`;

  return (
    `(function(){try{${CONSENT_READ_JS}var r=document.documentElement,w=window,` +
    `A=function(n,v){r.setAttribute('${ATTR}'+n,v||'')},${gpcJs}` +
    `if(g)${setAttr(CONSENT_GPC_ATTR)};if(${CONSENT_DECIDED_JS})${setAttr(CONSENT_DECIDED_ATTR)};` +
    `document.addEventListener('click',function(e){try{` +
    `var t=e.target,b=t.closest&&t.closest('[${CONSENT_SHELL_ATTR}] [${CONSENT_ACTION_ATTR}]');if(!b)return;` +
    `var x=b.getAttribute('${CONSENT_ACTION_ATTR}');` +
    `if(!/^(accept|reject|close)$/.test(x)){${setAttr(CONSENT_INTENT_ATTR, "x")};w.dispatchEvent(new CustomEvent('${CONSENT_SHELL_INTENT_EVENT}',{detail:x}));return}` +
    `${setAttr(CONSENT_DECIDED_ATTR)};` +
    `if(!w.dispatchEvent(new CustomEvent('${CONSENT_SHELL_DECISION_EVENT}',{detail:x,cancelable:!0})))return;` +
    `var y=x=='accept',z=y&&!g;${CONSENT_WRITE_JS}W(y,z,z);` +
    `try{localStorage.setItem('${SHELL_PENDING_KEY}','1')}catch(e){}` +
    `${consentModeJs}w.dispatchEvent(new Event('${CONSENT_CHANGE_EVENT}'))` +
    `}catch(e){}});${setAttr(CONSENT_JS_ATTR)}}catch(e){}})();`
  );
}

/**
 * Treść skryptu. IIFE w jednej linii - wstrzykiwana inline do `<head>`, więc
 * każdy znak to bajt na krytycznej ścieżce (osobny commit z pomiarem
 * `check-document-weight`). Zmienne: `r` - `<html>`, `w` - `window`, `A` -
 * ustawienie atrybutu `data-consent-*` na `<html>`, `g` - sygnał GPC, `x` -
 * akcja, `y` - akceptacja (functional), `z` - akceptacja kategorii klamrowanych
 * przez GPC (analytics, marketing). `data-consent-js` stoi NA KOŃCU części
 * synchronicznej: powłoka pokazuje się dopiero, gdy decyzja i GPC są
 * rozstrzygnięte, a nasłuch kliknięć założony - wyjątek po drodze zostawia
 * powłokę ukrytą, a partner skryptu montuje wtedy baner zaraz po boocie
 * (zachowanie sprzed P1.3).
 */
export const CONSENT_INIT_SCRIPT = /* @__PURE__ */ buildConsentInitScript();

/**
 * Skrypt odsłonięcia powłoki (P1.3b): ostatnie dziecko gniazda powłoki
 * (`ConsentShellSlot` w `__root.tsx`, wyłącznie render serwera), więc parser
 * wykonuje go DOPIERO po wstawieniu całej karty. Ustawia
 * `html[data-consent-parsed]`, bez którego karta ma `display: none` (wariant
 * w `ConsentShell.tsx`). Literał bez logiki i bez wstawek z bazy (każdy bajt
 * stoi w HTML-u każdej strony); bez JavaScriptu powłoka i tak jest ukryta
 * (`data-consent-js`), więc nie potrzebuje `<noscript>`.
 */
export const CONSENT_SHELL_REVEAL_SCRIPT = `document.documentElement.setAttribute('${CONSENT_PARSED_ATTR}','')`;

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
  /**
   * Klient zapytań i to, czy powłoka powstała z ZASIEWU ustawień
   * (`updatedAt: 0` - SSR nie zdążył pobrać `site_settings` w terminie fali 1
   * i wyrenderował kartę z wartości domyślnych). Odczyt MUSI paść w pierwszym
   * renderze korzenia (przed refetchem obserwatorów), dlatego robi go korzeń.
   * Recenzja P1.3, D5: powłoka jest migawką HTML-a serwera, więc gdy prawdziwe
   * ustawienia najemcy dojadą, a karta jest widoczna, baner przejmuje ją od
   * razu (wyłączony baner -> brak karty, własne teksty -> te teksty).
   */
  settings?: { queryClient: QueryClient; seeded: boolean };
}

/** Akcja kontrolki powłoki, która ma teraz fokus. */
function focusedShellAction(): ConsentShellAction | null {
  const active = document.activeElement;
  const control = active?.closest?.(`[${CONSENT_SHELL_ATTR}] [${CONSENT_ACTION_ATTR}]`);
  return parseShellAction(control?.getAttribute(CONSENT_ACTION_ATTR));
}

/**
 * Subskrypcja „zasiane ustawienia zastąpione prawdziwymi" (patrz
 * `ConsentTakeoverHost.settings`). Woła `listener` raz - od razu, jeśli refetch
 * skończył się przed startem partnera.
 */
function onSeededSettingsReplaced(
  { queryClient, seeded }: NonNullable<ConsentTakeoverHost["settings"]>,
  listener: () => void,
): () => void {
  if (!seeded) return () => {};
  const key = siteSettingsQueryOptions.queryKey;
  const replaced = () => (queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) > 0;
  if (replaced()) {
    listener();
    return () => {};
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (!replaced()) return;
    unsubscribe();
    listener();
  });
  return unsubscribe;
}

/**
 * Uruchamia partnera skryptu inline po hydratacji. Zwraca sprzątanie (cleanup
 * efektu korzenia). Kolejność kroków jest częścią kontraktu:
 *  1. nasłuch decyzji z powłoki - od teraz decyzję zapisuje `applyShellDecision`
 *     (droga banera), a skrypt inline widzi anulowane zdarzenie;
 *  2. domknięcie decyzji klikniętej PRZED tym momentem (znacznik
 *     `SHELL_PENDING_KEY`) i intencji czekającej w `html[data-consent-intent]`;
 *  3. stan powłoki dla koordynatora nakładek (do montażu banera, potem pisze
 *     baner): brak decyzji = karta zgód (powłoka albo za chwilę baner) =
 *     brama zamknięta;
 *  4. montaż banera - KIEDY zależy od tego, co odwiedzający widzi:
 *     - widoczna powłoka (brak decyzji): pierwsza interakcja (kolejka, klasa
 *       `shell`, cel = gniazdo; strażnik gestu trzyma krok do `click`),
 *       w ostateczności punkt ciszy (klasa `shell`);
 *     - brak decyzji, ale powłoka UKRYTA (sygnał GPC - karta banera ma notę,
 *       której powłoka nie ma; skrypt inline nie zadziałał; skrypt
 *       odsłonięcia za gniazdem się nie wykonał albo gniazda nie było w HTML-u):
 *       od razu po boocie (`release: "immediate"`) - jak przed P1.3, baner
 *       z notą. Boot startuje z modułu stojącego w dokumencie ZA gniazdem,
 *       więc brak `data-consent-parsed` w tej chwili jest ostateczny;
 *     - powłoka z ZASIEWU ustawień, gdy dojadą prawdziwe (D5): od razu;
 *     - intencja z powłoki albo `requestConsentPreferences()`: tor pilny
 *       (start importu w pierwszym mikrozadaniu);
 *     - decyzja zapisana (powłoka ukryta, baner i tak renderuje `null`): BEZ
 *       wpisu `shell` - pierwsze zadanie po interakcji nie płaci za import
 *       i render banera (recenzja P1.3, D6); montaż w punkcie ciszy, klasa
 *       `overlays`. Gdy decyzja zniknie (wycofanie w innej karcie), powłoka
 *       wraca, a z nią wpis `shell`. Stan zgody koordynatorowi zgłasza do
 *       montażu partner, więc montażu nadal nie trzeba wiązać z decyzją, żeby
 *       brama nakładek była poprawna.
 */
export function startConsentTakeover({ mount, slot, settings }: ConsentTakeoverHost): () => void {
  if (typeof window === "undefined") return () => {};
  const html = document.documentElement;
  let active = true;
  let intent: ConsentShellAction | null = null;
  let started: Promise<void> | null = null;
  let stopReporting: () => void = () => {};
  let shellScheduled = false;
  let staleShell = false;
  const cancels: Array<() => void> = [];

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
  const mountSoon = () => {
    cancels.push(enqueue(mountOnce, { priority: "shell", release: "immediate" }));
  };
  /**
   * Karta zgód należy się odwiedzającemu, ale powłoki nie widać (GPC, brak
   * skryptu inline, brak odsłonięcia za gniazdem) - te same warunki co warianty
   * ukrywania w `ConsentShell.tsx`.
   */
  const shellHidden = () =>
    html.hasAttribute(CONSENT_GPC_ATTR) ||
    !html.hasAttribute(CONSENT_JS_ATTR) ||
    !html.hasAttribute(CONSENT_PARSED_ATTR);

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

  // Wpis montażu dla odwiedzającego BEZ decyzji - raz, przy pierwszym
  // zgłoszeniu „brak decyzji" (od razu przy starcie albo po wycofaniu zgody).
  const scheduleUndecided = () => {
    if (staleShell && !shellHidden()) mountSoon();
    if (shellScheduled) return;
    shellScheduled = true;
    if (shellHidden()) mountSoon();
    else cancels.push(enqueue(mountOnce, { priority: "shell", target: slot }));
  };
  // Do montażu banera (`mountOnce` zdejmuje ten nasłuch tuż przed montażem).
  const report = (): boolean => {
    const { decided, marketing } = readConsentOverlayReport();
    reportConsentSurface(!decided, marketing);
    html.toggleAttribute(CONSENT_DECIDED_ATTR, decided);
    if (!decided) scheduleUndecided();
    return decided;
  };
  const decidedAtStart = report();
  stopReporting = subscribeConsentChange(report);

  if (settings) {
    cancels.push(
      onSeededSettingsReplaced(settings, () => {
        staleShell = true;
        if (!html.hasAttribute(CONSENT_DECIDED_ATTR) && !shellHidden()) mountSoon();
      }),
    );
  }
  cancels.push(onQuiescent(mountOnce, { priority: decidedAtStart ? "overlays" : "shell" }));

  return () => {
    active = false;
    window.removeEventListener(CONSENT_SHELL_DECISION_EVENT, onDecision);
    window.removeEventListener(CONSENT_SHELL_INTENT_EVENT, onIntent);
    window.removeEventListener(OPEN_PREFS_EVENT, mountUrgently);
    for (const cancel of cancels) cancel();
    stopReporting();
  };
}
