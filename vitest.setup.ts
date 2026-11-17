import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// LIMIT NARZĘDZI ASYNCHRONICZNYCH RTL JEST OSOBNY OD `testTimeout` I DOMYŚLNIE
// MA SEKUNDĘ. `vitest.config.ts` podnosi `testTimeout` do 20 s z uzasadnieniem
// „margines na kontencję CPU, bez maskowania realnych zawieszeń" - ale `waitFor`
// i `findBy*` liczą własny zegar (1000 ms) i tamten limit ich nie dotyczy.
// Skutek zmierzony na dwóch pełnych przejazdach suity po podziale monolitu
// `editorMatrix` (odzyskana równoległość = więcej plików naraz na czterech
// rdzeniach): DWA różne testy tego samego pliku
// `src/routes/__tests__/adminImportWordpressRoute.test.tsx` oblały się na
// „Unable to find an element with the text" i „expected vi.fn() to be called at
// least once", a ten sam plik uruchomiony sam przechodzi 44/44. To nie jest
// defekt tych testów ani „flake" do przeczekania: to zegar dobrany pod maszynę
// bez obciążenia.
//
// PIĘĆ SEKUND NIE MASKUJE REGRESJI. `waitFor` nadal PADA, gdy warunek nigdy się
// nie spełni - rośnie wyłącznie tolerancja na opóźnienie harmonogramu. Sprawdzone
// przed zmianą: w repo nie ma ani jednego testu, który liczyłby na TIMEOUT
// `waitFor` (żadnego `await expect(waitFor(...)).rejects`), więc nikomu nie
// wydłuża to przebiegu o czekanie na porażkę.
configure({ asyncUtilTimeout: 5000 });

// Neutralise fire-and-forget beacons in unit tests. happy-dom implements
// `navigator.sendBeacon` by performing a REAL network request, so components
// that beacon telemetry on render (ad impressions, popup views, web-vitals,
// client-error capture) would otherwise emit an unhandled socket error after
// the test completes and flake the run. A no-op default keeps unit tests off
// the network; observability tests that assert beacon behaviour still override
// `navigator.sendBeacon` per-test (and restore the original) as before.
// OSŁONA DESKRYPTOREM: `navigator.sendBeacon` bywa w happy-dom definiowany jako
// właściwość NIEKONFIGUROWALNA (zmienia się to między wydaniami). Wtedy samo
// `Object.defineProperty` RZUCA - a rzut w pliku setupowym oblewa KAŻDY plik
// testowy w domyślnym środowisku, we wszystkich shardach, plus bramki
// `check:chunk-parity`, `check:permissions-parity`, `check:i18n-parity`,
// `check:ci-gates` i `check:widget-fidelity`. Dlatego: podmieniamy tylko, gdy
// deskryptor na to pozwala, a próbę i tak domykamy `try`/`catch`. Środowiska
// testowego NIE zmieniamy.
if (typeof navigator !== "undefined") {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
  const patchable = descriptor === undefined || descriptor.configurable === true;
  if (patchable) {
    try {
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        writable: true,
        value: () => true,
      });
    } catch {
      // Silnik nie pozwolił na podmianę - testy obserwowalności nadpisują
      // `sendBeacon` per-test, a reszta suity nie może z tego powodu padać.
    }
  } else if (descriptor.writable === true) {
    navigator.sendBeacon = () => true;
  }
}

// Tag Google działa tylko na neweuropeanstrategies.com (tagIds.ts); jsdom
// stoi na localhost, więc suity tagów zdejmują bramkę hosta flagą.
if (typeof window !== "undefined") {
  Reflect.set(window, "__NES_GA_ANY_HOST__", true);
}

// SPECYFIKACYJNY `Node.prototype.nodeName` W HAPPY-DOM. DOMPurify od 3.4.8
// czyta `nodeName` getterem z `Node.prototype` (hartowanie przed podmianą
// prototypów). happy-dom definiuje właściwą wartość na klasach POCHODNYCH, a
// getter bazowy zwraca "" - wtedy allowlista nie dopasowuje tagów i
// `<script>` przeżywa sanityzację (opis: src/lib/sanitizeEngineGuard.ts).
// Przeglądarki i jsdom są zgodne ze specyfikacją; tu wyrównujemy WYŁĄCZNIE
// środowisko testowe, żeby suita mierzyła poprawioną bibliotekę, a nie usterkę
// emulatora. Kod produkcyjny i kanarek fail-closed zostają bez zmian.
if (typeof Node !== "undefined") {
  const base = Object.getOwnPropertyDescriptor(Node.prototype, "nodeName");
  const baseGet = base?.get;
  if (baseGet && base.configurable === true) {
    const inFlight = new WeakSet<object>();
    Object.defineProperty(Node.prototype, "nodeName", {
      configurable: true,
      enumerable: base.enumerable,
      get(this: Node): string {
        if (inFlight.has(this)) return baseGet.call(this);
        inFlight.add(this);
        try {
          let proto: object | null = Object.getPrototypeOf(this);
          while (proto && proto !== Node.prototype) {
            const own = Object.getOwnPropertyDescriptor(proto, "nodeName");
            if (own?.get) return own.get.call(this);
            proto = Object.getPrototypeOf(proto);
          }
          return baseGet.call(this);
        } finally {
          inFlight.delete(this);
        }
      },
    });
  }
}
