// LOADER BOOTU (P2.1, krok 2; P3.4) - klasyczny, inline'owy skrypt w `<head>`, zaraz po sondzie
// bootu (`lib/observability/bootProbeScript.ts`). Startuje aplikację: wstawia `<link
// rel=modulepreload>` listy z `#nes-boot-set` (`bootSet.server.ts`) grupami zestawu i `<script
// type="module" src=wejście>` - to drugie NIGDY przed zażądaniem ostatniej grupy ani przed końcem
// parsowania dokumentu (niżej, „SERIA GRUPAMI” i „WEJŚCIE PO PARSOWANIU”).
//
// PO CO. Manifest TanStack Start nie startuje już JS-a (`scripts/lib/bootAfterLcpPlugin.ts`).
// Lantern liczy do grafu FCP/LCP każdy skrypt zakończony przed OBSERWOWANYM LCP (PLAN §1.3,
// inwariant 1), a podpowiedzi priorytetu nie działają - jedyne wyjście to START serii po LCP.
// Werdykt boot-js C3 zmierzył, że wyzwalaczem musi być wpis `largest-contentful-paint`
// (dostarczany po prezentacji klatki) z marginesem, a nie `load` obrazu ani `window.load`.
//
// KIEDY BOOT (pierwszy spełniony warunek; `boot()` jest idempotentny):
//   - OD RAZU (`now`): tryb serwera `now` (trasy bez kandydata LCP), zapisana sesja albo ramka
//     (`STORED_SESSION_EXPR` z P1.7: zalogowany, podgląd edytora), `document.prerendering`,
//     przeglądarka bez wpisów `largest-contentful-paint` (Safari) - odroczenie nie ma tam celu,
//     a zalogowani i edytor muszą dostać aplikację bez czekania;
//   - PO LCP (`lcp`): `PerformanceObserver({type: "largest-contentful-paint", buffered: true})`
//     przyjmuje wpis, gdy (i) `entry.element` ma `data-lcp-candidate` albo `entry.url` to
//     `currentSrc` kandydata, albo (ii) `entry.size` >= widoczne pole kandydata (w (ii) kandydat
//     nie wygeneruje już późniejszego wpisu - LCP raportuje tylko elementy ściśle większe - więc
//     LCP jest ostateczny względem kandydata). Mniejsze wpisy (tekst przy `font-display: swap`,
//     malowany przed obrazem) są ignorowane. Po przyjęciu: `setTimeout(boot, 50)`;
//   - zapasy: pierwsze `pointerdown`/`keydown`/`touchstart`/`focusin` (capture) - natychmiast;
//     brak kandydata albo kandydat poza oknem po pierwszej klatce od DOMContentLoaded, albo
//     `error` obrazu kandydata - rAF + `setTimeout(0)` (`nocand`); `load` + 500 ms (czeka jeszcze
//     na przyjęty wpis; samo `load` bywa PRZED obserwowanym LCP - werdykt C3, przebieg B1);
//     twardy limit DOMContentLoaded + 3 s.
//
// POLE KANDYDATA BEZ WYMUSZONEGO UKŁADU (P3.4, K4i). Handler DOMContentLoaded nie czyta
// geometrii: `getBoundingClientRect` w nim wymuszał pełny Style+Layout dokumentu w zadaniu DCL
// (księga bazy W3 desktop4x: `Script:(dokument)` 98 ms obs., z czego Style+Layout 71 ms, 146 ms
// blokowania). Pole (ii) liczy funkcja X w zadaniu po pierwszej klatce od DCL (rAF, potem
// `setTimeout(0)`): układ jest wtedy czysty, bo policzyła go klatka, więc odczyt nic nie wymusza.
// Tam też zapada `nocand` dla kandydata poza oknem; dokument BEZ kandydata nie dotyka geometrii
// wcale (pusta lista `img[data-lcp-candidate]`). Wpis LCP sprzed pomiaru czeka w V i jest
// oceniany w X - jak dawniej w handlerze DCL.
//
// SERIA GRUPAMI (P3.4). Zestaw niesie granice grup w `g` (indeksy w `u`, wyznacza je serwer):
// (1) domknięcie wejścia (wejście + vendory), (2) słownik języka + chunki trasy, (3) chunki
// widgetów nad zgięciem. Każda grupa idzie w OSOBNYM zadaniu (`setTimeout(0)` między grupami),
// żeby dokończenia kompilacji serii nie lądowały w jednym długim zadaniu (`ScriptCatchup`).
// Wejście dopiero po zażądaniu ostatniej grupy, więc reguła CLS z werdyktu boot-js C3 („chunki
// widgetów nad zgięciem w tym samym burście co wejście”) obowiązuje nadal: żaden moduł nie
// ewaluuje się przed zażądaniem wszystkich. Wyzwalacz `now` (zalogowani, panel, trasy bez
// kandydata) wstawia całą serię naraz - bez czekania. Zestaw bez `g` (albo z `g` spoza zakresu)
// to jedna grupa.
//
// WEJŚCIE PO PARSOWANIU (poprawka po Prove P2.1). Na bazie wejście było skryptem parserowym
// (`type=module` = `defer`): wykonywało się dopiero po sparsowaniu CAŁEGO dokumentu. Moduł
// wstawiony skryptem jest `async` - wykonuje się zaraz po pobraniu. Wyzwalacze `now`, `lcp`
// (reguła (i)), `input` i `nocand` (błąd obrazu) nie czekają na DOMContentLoaded, więc przy
// dokumencie w porcjach (wolne łącze z obrazem i modułami z cache, zalogowany albo podgląd
// edytora z `now` w `<head>`, tapnięcie w trakcie ładowania, strumieniowy MISS) `hydrate()`
// TanStack startował bez ogona dokumentu (`window.$_TSR`) i rzucał `Invariant failed` - martwy
// SSR. Dlatego boot ma dwie fazy: seria `modulepreload` od razu (pobieranie bez wykonania),
// wejście dopiero przy `readyState != "loading"`, inaczej z handlera DOMContentLoaded - dokładnie
// semantyka `defer`. Przy dokumencie HIT nic się nie zmienia: DCL przychodzi przed obserwowanym
// LCP + 50 ms.
//
// ZESTAW CZYTANY LENIWIE. `#nes-boot-set` przychodzi z buforem routera przy pierwszej granicy
// strumienia. W zmierzonych dokumentach stoi PRZED loaderem (baza W3: offset 11 727 B wobec
// 23 290 B loadera; spike P2.1: 498–11 497 B w 36/36), więc odczyt przy starcie skryptu go
// zastaje. Gdy go nie ma, ostatnia szansa to DOMContentLoaded (P3.4: bez `MutationObserver`
// z `subtree` na całym dokumencie w trakcie parsowania - w śladach bazy nie był ani razu
// uzbrojony, a jego rolę przejmuje odczyt przy DCL; dokument `now` i tak ma serię w nagłówku
// `Link`). Brak przy DOMContentLoaded (dev: `<Scripts>` frameworka startuje aplikację sam) - nic
// nie robimy. Węzeł jest USUWANY od razu po odczycie, czyli zawsze przed wstawieniem wejścia:
// obcy węzeł w zwykłym (nie singletonowym) rodzicu byłby niedopasowaniem hydratacji (React 19
// pomija obce węzły tylko w `html`/`head`/`body`).
//
// OBSERWOWALNOŚĆ. `window.__nesBootWhy` = `now` | `lcp` | `input` | `nocand` | `load` | `cap`
// (co wyzwoliło boot - e2e i pomiar; ustawiane przy wyzwoleniu, przed DCL też), a
// `window.__nesBootArm()` z sondy bootu uzbraja watchdog martwej hydratacji w chwili wstawienia
// wejścia (krok 4), nie od pierwszego bajtu dokumentu ani od serii `modulepreload` (długi ogon
// strumienia nie jest martwym bootem).
//
// DOKTRYNA. Jedno IIFE, ES5, bez sieci i bez zapisu do storage (sesję tylko CZYTA wyrażenie
// z `sessionHint.ts`). Funkcje są deklarowane poza `try`, a start w `try` ma zapas: wyjątek
// w uzbrajaniu wyzwalaczy kończy się bootem przy DOMContentLoaded, nigdy dokumentem bez JS-a.
// `setTimeout(0)` przed hydratacją w `src/router.tsx` zostaje - ten skrypt tylko wstawia wejście.
// Stała modułu bez danych: serwer renderuje ją w `<head>` (`__root.tsx`), przeglądarka przepisuje
// ten sam tekst z wykonanego już węzła `script[data-nes-boot]`, więc literał nie trafia do bundla
// klienta (zapas domknięcia bootu, `check:bundle` i `document-weight`). Tekst stoi w `<head>`
// każdego dokumentu, a próg `headRawBytes` ma ~0,4 KB zapasu: P3.4 nie powiększa go netto
// (grupy i pomiar po klatce opłacone usunięciem obserwatora mutacji).
import { STORED_SESSION_EXPR } from "@/integrations/supabase/sessionHint";

/** Id węzła zestawu bootu - kontrakt z `bootSet.server.ts`, e2e i `documentWeight.ts`. */
export const BOOT_SET_ELEMENT_ID = "nes-boot-set";
/** Opóźnienie bootu po przyjętym wpisie LCP (prezentacja klatki + margines, werdykt C3). */
export const BOOT_AFTER_LCP_DELAY_MS = 50;
/** Ile `load` czeka jeszcze na przyjęty wpis LCP. */
export const BOOT_AFTER_LOAD_DELAY_MS = 500;
/** Twardy limit od DOMContentLoaded. */
export const BOOT_HARD_CAP_MS = 3_000;
/** Atrybut węzła loadera - klient odczytuje z niego tekst przy hydratacji. */
export const BOOT_LOADER_ATTR = "data-nes-boot";

/** Co wyzwoliło boot (`window.__nesBootWhy`). */
export type BootTrigger = "now" | "lcp" | "input" | "nocand" | "load" | "cap";

declare global {
  interface Window {
    /** Co wyzwoliło boot - zapisuje loader bootu (`lib/boot/bootLoaderScript.ts`). */
    __nesBootWhy?: BootTrigger;
  }
}

// Nazwy w skrypcie (jednoliterowe, bo tekst stoi w `<head>` każdego dokumentu - budżet
// `headRawBytes`): B boot, J kolejna grupa serii, H wstawienie wejścia (po ostatniej grupie
// i po parsowaniu), T opóźniony boot, L wywołanie po pierwszej klatce (rAF + `setTimeout(0)`),
// M boot `nocand`, G interakcja, Q odczyt zestawu, O przyjęcie wpisu LCP, Z widoczne pole
// elementu, X pole kandydata po klatce, C decyzja trybu, Y DOMContentLoaded, I kandydaci;
// S zestaw, R zestaw odczytany, D decyzja zapadła, F boot wykonany, W powód sprzed odczytu,
// P PerformanceObserver, V ostatni wpis LCP, A pole kandydata, U nazwa zdarzenia DCL,
// g granice grup, k następna granica.
export const BOOT_LOADER_SCRIPT = [
  "(function(){",
  'var w=window,d=document,S,R,D,F,W,P,V,A=0,N="largest-contentful-paint",U="DOMContentLoaded",',
  'E=["pointerdown","keydown","touchstart","focusin"],K="data-lcp-candidate";',
  // Boot: seria `modulepreload` grupami (każda grupa w osobnym zadaniu, `now` naraz), wejście
  // po ostatniej grupie i po sparsowaniu dokumentu (H); bez zestawu zapamiętuje powód do chwili
  // odczytu. Granica spoza zakresu nie wstawia `undefined` (warunek `i<S.u.length`).
  "function B(y){if(F)return;if(!S){W=W||y;return}F=1;w.__nesBootWhy=y;",
  'for(var i=0,k=0,g=y=="now"?[]:S.g||[];i<E.length;i++)w.removeEventListener(E[i],G,!0);',
  "try{P&&P.disconnect()}catch(x){}i=0;",
  "(function J(){for(var j=k<g.length?g[k++]:S.u.length,l;i<j&&i<S.u.length;i++){",
  'l=d.createElement("link");l.rel="modulepreload";l.href=S.u[i];d.head.appendChild(l)}',
  'i<S.u.length?setTimeout(J):d.readyState=="loading"?d.addEventListener(U,H):H()})()}',
  // Wejście (semantyka `defer` z bazy): moduł wstawiony skryptem jest `async`, a hydratacja
  // TanStack wymaga ogona dokumentu (`$_TSR`); watchdog sondy liczy od tej chwili.
  'function H(){w.__nesBootArm&&w.__nesBootArm();var l=d.createElement("script");',
  'l.type="module";l.src=S.e;d.head.appendChild(l)}',
  "function T(t,y){setTimeout(function(){B(y)},t)}",
  "function L(f){d.hidden?setTimeout(f):requestAnimationFrame(function(){setTimeout(f)})}",
  'function M(){B("nocand")}',
  'function G(){B("input")}',
  'function I(){return d.querySelectorAll("img["+K+"]")}',
  // Odczyt zestawu: raz, z usunięciem węzła; śmieci = brak zestawu.
  `function Q(){var n=d.getElementById("${BOOT_SET_ELEMENT_ID}");if(n){R=1;`,
  "try{S=JSON.parse(n.textContent)}catch(x){}",
  'if(!S||typeof S.e!="string"||!(S.u instanceof Array))S=null;n.remove()}}',
  // Wpis LCP: (i) kandydat po elemencie albo URL-u, (ii) pole >= widocznego pola kandydata.
  "function O(e){var c=I(),i,n=e.element;if(n&&n.hasAttribute&&n.hasAttribute(K))return 1;",
  "for(i=0;i<c.length;i++)if(e.url&&e.url==c[i].currentSrc)return 1;return A>0&&e.size>=A}",
  "function Z(n){var r=n.getBoundingClientRect(),",
  "x=Math.min(r.right,w.innerWidth)-Math.max(r.left,0),",
  "y=Math.min(r.bottom,w.innerHeight)-Math.max(r.top,0);return x>0&&y>0?x*y:0}",
  // Pole kandydata po pierwszej klatce od DCL (układ czysty); brak widocznego - `nocand`,
  // inaczej ocena wpisu sprzed pomiaru. Po bootie (np. interakcja) - bez geometrii.
  "function X(){if(!F){for(var c=I(),i=0,a;i<c.length;i++){a=Z(c[i]);if(a>A)A=a}",
  `A?V&&O(V)&&T(${BOOT_AFTER_LCP_DELAY_MS},"lcp"):M()}}`,
  // Decyzja po odczycie zestawu: od razu albo obserwator LCP.
  "function C(){if(D||!S)return;D=1;var O2=w.PerformanceObserver,t=O2&&O2.supportedEntryTypes;",
  'if(W)return B(W);if(S.m!="lcp"||d.prerendering||!t||t.indexOf(N)<0',
  `||${STORED_SESSION_EXPR})return B("now");`,
  "try{P=new O2(function(l){var es=l.getEntries();for(var i=0;i<es.length;i++){",
  `V=es[i];if(O(V))T(${BOOT_AFTER_LCP_DELAY_MS},"lcp")}});`,
  'P.observe({type:N,buffered:!0})}catch(x){B("now")}}',
  // DOMContentLoaded: zestaw (ostatnia szansa), limit, pomiar pola PO klatce - bez geometrii tu.
  `function Y(){R||Q();C();T(${BOOT_HARD_CAP_MS},"cap");F||!S||L(X)}`,
  // Start: zapasy (interakcja, błąd kandydata, `load`), zestaw teraz albo przy DCL.
  "try{for(var i=0;i<E.length;i++)w.addEventListener(E[i],G,{capture:!0,passive:!0});",
  'd.addEventListener("error",function(e){e=e.target;',
  "e&&e.hasAttribute&&e.hasAttribute(K)&&L(M)},!0);",
  `w.addEventListener("load",function(){T(${BOOT_AFTER_LOAD_DELAY_MS},"load")});`,
  'Q();C();d.readyState=="loading"?d.addEventListener(U,Y):Y()',
  // Zapas: wyjątek w uzbrajaniu nie zostawia dokumentu bez bootu.
  '}catch(_){try{d.addEventListener(U,function(){R||Q();B("now")})}catch(x){}}',
  "})();",
].join("");
