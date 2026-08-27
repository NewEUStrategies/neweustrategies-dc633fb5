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
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: () => true,
  });
}
