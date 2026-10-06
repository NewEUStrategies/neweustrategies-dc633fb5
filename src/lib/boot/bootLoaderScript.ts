// LOADER BOOTU (P2.1, krok 2) - klasyczny, inline'owy skrypt w `<head>`, zaraz po sondzie bootu
// (`lib/observability/bootProbeScript.ts`). Startuje aplikację: wstawia `<link rel=modulepreload>`
// całej listy z `#nes-boot-set` (`bootSet.server.ts`) i `<script type="module" src=wejście>`.
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
//     `currentSrc` kandydata, albo (ii) `entry.size` >= widoczne pole kandydata zmierzone przy
//     DOMContentLoaded (w (ii) kandydat nie wygeneruje już późniejszego wpisu - LCP raportuje
//     tylko elementy ściśle większe - więc LCP jest ostateczny względem kandydata). Mniejsze
//     wpisy (tekst przy `font-display: swap`, malowany przed obrazem) są ignorowane. Po
//     przyjęciu: `setTimeout(boot, 50)`;
//   - zapasy: pierwsze `pointerdown`/`keydown`/`touchstart`/`focusin` (capture) - natychmiast;
//     brak widocznego kandydata przy DOMContentLoaded albo `error` obrazu kandydata - rAF +
//     `setTimeout(0)`; `load` + 500 ms (czeka jeszcze na przyjęty wpis; samo `load` bywa PRZED
//     obserwowanym LCP - werdykt C3, przebieg B1); twardy limit DOMContentLoaded + 3 s.
//
// ZESTAW CZYTANY LENIWIE. `#nes-boot-set` przychodzi z buforem routera przy pierwszej granicy
// strumienia - przed albo po tym skrypcie. Brak przy starcie: `MutationObserver` do pierwszego
// pojawienia się albo do DOMContentLoaded. Brak przy DOMContentLoaded (dev: `<Scripts>`
// frameworka startuje aplikację sam) - nic nie robimy. Węzeł jest USUWANY od razu po odczycie,
// czyli zawsze przed wstawieniem wejścia: obcy węzeł w zwykłym (nie singletonowym) rodzicu byłby
// niedopasowaniem hydratacji (React 19 pomija obce węzły tylko w `html`/`head`/`body`).
//
// OBSERWOWALNOŚĆ. `window.__nesBootWhy` = `now` | `lcp` | `input` | `nocand` | `load` | `cap`
// (co wyzwoliło boot - e2e i pomiar), a `window.__nesBootArm()` z sondy bootu uzbraja watchdog
// martwej hydratacji od startu bootu (krok 4), nie od pierwszego bajtu dokumentu.
//
// DOKTRYNA. Jedno IIFE, ES5, bez sieci i bez zapisu do storage (sesję tylko CZYTA wyrażenie
// z `sessionHint.ts`). Funkcje są deklarowane poza `try`, a start w `try` ma zapas: wyjątek
// w uzbrajaniu wyzwalaczy kończy się bootem przy DOMContentLoaded, nigdy dokumentem bez JS-a.
// `setTimeout(0)` przed hydratacją w `src/router.tsx` zostaje - ten skrypt tylko wstawia wejście.
// Stała modułu bez danych: serwer renderuje ją w `<head>` (`__root.tsx`), przeglądarka przepisuje
// ten sam tekst z wykonanego już węzła `script[data-nes-boot]`, więc literał nie trafia do bundla
// klienta (zapas domknięcia bootu, `check:bundle` i `document-weight`).
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
// `headRawBytes`): B boot, T opóźniony boot, L rAF + `setTimeout(0)`, G interakcja, Q odczyt
// zestawu, O przyjęcie wpisu LCP, Z widoczne pole elementu, C decyzja trybu, Y DOMContentLoaded,
// I kandydaci; S zestaw, R zestaw odczytany, D decyzja zapadła, F boot wykonany, W powód sprzed
// odczytu, M MutationObserver, P PerformanceObserver, V ostatni wpis LCP, A pole kandydata.
export const BOOT_LOADER_SCRIPT = [
  "(function(){",
  'var w=window,d=document,S,R,D,F,W,M,P,V,A=0,N="largest-contentful-paint",',
  'E=["pointerdown","keydown","touchstart","focusin"],K="data-lcp-candidate";',
  // Boot: seria `modulepreload` + wejście; bez zestawu zapamiętuje powód do chwili odczytu.
  "function B(y){if(F)return;if(!S){W=W||y;return}F=1;w.__nesBootWhy=y;",
  "for(var i=0;i<E.length;i++)w.removeEventListener(E[i],G,!0);",
  "try{P&&P.disconnect()}catch(x){}w.__nesBootArm&&w.__nesBootArm();",
  'for(i=0;i<S.u.length;i++){var l=d.createElement("link");l.rel="modulepreload";',
  "l.href=S.u[i];d.head.appendChild(l)}",
  'l=d.createElement("script");l.type="module";l.src=S.e;d.head.appendChild(l)}',
  "function T(t,y){setTimeout(function(){B(y)},t)}",
  "function L(y){d.hidden?T(0,y):requestAnimationFrame(function(){T(0,y)})}",
  'function G(){B("input")}',
  'function I(){return d.querySelectorAll("img["+K+"]")}',
  // Odczyt zestawu: raz, z usunięciem węzła; śmieci = brak zestawu.
  `function Q(){var n=d.getElementById("${BOOT_SET_ELEMENT_ID}");if(!n)return 0;R=1;`,
  "try{S=JSON.parse(n.textContent)}catch(x){}",
  'if(!S||typeof S.e!="string"||!(S.u instanceof Array))S=null;n.remove();return 1}',
  // Wpis LCP: (i) kandydat po elemencie albo URL-u, (ii) pole >= widocznego pola kandydata.
  "function O(e){var c=I(),i,n=e.element;if(n&&n.hasAttribute&&n.hasAttribute(K))return 1;",
  "for(i=0;i<c.length;i++)if(e.url&&e.url==c[i].currentSrc)return 1;return A>0&&e.size>=A}",
  "function Z(n){var r=n.getBoundingClientRect(),",
  "x=Math.min(r.right,w.innerWidth)-Math.max(r.left,0),",
  "y=Math.min(r.bottom,w.innerHeight)-Math.max(r.top,0);return x>0&&y>0?x*y:0}",
  // Decyzja po odczycie zestawu: od razu albo obserwator LCP.
  "function C(){if(D||!S)return;D=1;var O2=w.PerformanceObserver,t=O2&&O2.supportedEntryTypes;",
  'if(W)return B(W);if(S.m!="lcp"||d.prerendering||!t||t.indexOf(N)<0',
  `||${STORED_SESSION_EXPR})return B("now");`,
  "try{P=new O2(function(l){var es=l.getEntries();for(var i=0;i<es.length;i++){",
  `V=es[i];if(O(V))T(${BOOT_AFTER_LCP_DELAY_MS},"lcp")}});`,
  'P.observe({type:N,buffered:!0})}catch(x){B("now")}}',
  // DOMContentLoaded: zestaw (ostatnia szansa), limit, pole kandydata, wpis sprzed DCL.
  "function Y(){try{M&&M.disconnect()}catch(x){}R||Q();C();",
  `T(${BOOT_HARD_CAP_MS},"cap");if(F||!S)return;`,
  "for(var c=I(),i=0,a,b=0;i<c.length;i++){a=Z(c[i]);if(a>A){A=a;b=1}}",
  `if(!b)return L("nocand");V&&O(V)&&T(${BOOT_AFTER_LCP_DELAY_MS},"lcp")}`,
  // Start: zapasy (interakcja, błąd kandydata, `load`), zestaw teraz albo po pojawieniu się.
  "try{for(var i=0;i<E.length;i++)w.addEventListener(E[i],G,{capture:!0,passive:!0});",
  'd.addEventListener("error",function(e){e=e.target;',
  'e&&e.hasAttribute&&e.hasAttribute(K)&&L("nocand")},!0);',
  `w.addEventListener("load",function(){T(${BOOT_AFTER_LOAD_DELAY_MS},"load")});`,
  'if(Q())C();else if(d.readyState=="loading")try{',
  "M=new MutationObserver(function(){Q()&&(M.disconnect(),C())});",
  "M.observe(d.documentElement,{childList:!0,subtree:!0})}catch(x){}",
  'd.readyState=="loading"?d.addEventListener("DOMContentLoaded",Y):Y()',
  // Zapas: wyjątek w uzbrajaniu nie zostawia dokumentu bez bootu.
  '}catch(_){try{d.addEventListener("DOMContentLoaded",function(){R||Q();B("now")})}catch(x){}}',
  "})();",
].join("");
