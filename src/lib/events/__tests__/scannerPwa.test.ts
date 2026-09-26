// Testy instalowalnosci skanera: rejestracja Service Workera i straznik
// zdarzenia instalacji.
//
// PO CO TEN PLIK ISTNIEJE. Rejestracja workera dzieje sie przy PIERWSZYM
// renderze trasy /scanner, czyli w chwili, w ktorej wolontariusz wlasnie
// otwiera bramke. Kazdy blad tutaj jest bledem na starcie zmiany, wiec modul
// ma dwie powinnosci naraz: nie wywalic sie NIGDY i nie zarejestrowac workera
// tam, gdzie nie wolno.
//
// LAPIEMY TRZY KLASY BLEDOW.
//
// 1) WYJATEK ALBO NIEOBSLUZONE ODRZUCENIE NA STARCIE EKRANU. `register()`
//    odrzuca w oknie prywatnym, przy wylaczonych ciasteczkach i gdy pliku
//    workera nie ma pod adresem. Worker jest przyspieszeniem, nie warunkiem
//    dzialania - wiec kazda taka porazka ma byc CICHA. Test sprawdza to
//    twardo: liczy nieobsluzone odrzucenia obietnic.
//
// 2) ZLAMANA UMOWA O ZASIEGU. `scope: "/scanner"` jest tu po to, zeby ten
//    worker NIE przejal calej witryny i nie wszedl w droge `push-sw.js`.
//    Literowka w zasiegu albo w sciezce nie wywala niczego widocznego -
//    po prostu powiadomienia albo cala reszta serwisu zaczynaja chodzic przez
//    zly worker. Dlatego asercja idzie po DOSLOWNYCH napisach.
//
// 3) REJESTRACJA TAM, GDZIE NIE WOLNO. Bez `window` (render na serwerze),
//    bez `serviceWorker` w navigatorze i w kontekscie NIEZABEZPIECZONYM (http)
//    proba rejestracji konczy sie wyjatkiem albo bledem w konsoli u kazdego
//    uzytkownika. Kazdy z tych trzech warunkow ma tu wlasny przypadek, bo
//    kazdy zostal dopisany po innym incydencie.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isInstallPromptEvent,
  registerScannerServiceWorker,
  type InstallPromptEvent,
} from "@/lib/events/scannerPwa";

/** Doslowne wartosci kontraktu - patrz punkt 2 naglowka. */
const SW_PATH = "/scanner-sw.js";
const SW_SCOPE = "/scanner";

type RegisterMock = ReturnType<typeof vi.fn>;

/**
 * Ustawia przegladarke, w ktorej rejestracja MA sie odbyc: bezpieczny kontekst
 * i navigator z Service Workerem.
 */
function installBrowser(register: RegisterMock): void {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { serviceWorker: { register } });
}

/** Zbiera nieobsluzone odrzucenia obietnic z jednego przebiegu. */
async function unhandledRejectionsDuring(run: () => void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const listener = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on("unhandledRejection", listener);
  try {
    run();
    // Odrzucenie bez uchwytu zglasza sie dopiero po opuszczeniu biezacego
    // przebiegu petli zdarzen - stad realny odstep, nie sam mikrotask.
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off("unhandledRejection", listener);
  }
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rejestracja Service Workera skanera", () => {
  it("rejestruje UMOWIONY plik w UMOWIONYM, wezszym zasiegu", async () => {
    const register = vi.fn(() => Promise.resolve({}));
    installBrowser(register);

    registerScannerServiceWorker();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(SW_PATH, { scope: SW_SCOPE });
  });

  it("NIE czeka na wynik rejestracji - powolna instalacja nie blokuje ekranu", () => {
    // Obietnica, ktora nigdy sie nie rozwiaze: gdyby modul na nia czekal,
    // ekran bramki wisialby az do zamkniecia karty.
    const register = vi.fn(() => new Promise<unknown>(() => undefined));
    installBrowser(register);

    expect(registerScannerServiceWorker()).toBeUndefined();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("ODRZUCONA rejestracja konczy sie cicho, bez nieobsluzonego odrzucenia", async () => {
    // Okno prywatne, wylaczone ciasteczka, brak pliku pod adresem - wszystkie
    // te przypadki odrzucaja obietnice. Nieobsluzone odrzucenie zaslmieciloby
    // konsole i raporty bledow przy KAZDYM otwarciu skanera.
    const register = vi.fn(() => Promise.reject(new Error("SecurityError: odmowa rejestracji")));
    installBrowser(register);

    const rejections = await unhandledRejectionsDuring(() => {
      expect(() => registerScannerServiceWorker()).not.toThrow();
    });

    expect(register).toHaveBeenCalledTimes(1);
    expect(rejections).toEqual([]);
  });

  it("bez `window` (render na serwerze) nie siega nawet po navigatora", () => {
    const register = vi.fn(() => Promise.resolve({}));
    installBrowser(register);
    vi.stubGlobal("window", undefined);

    expect(() => registerScannerServiceWorker()).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it("przegladarka BEZ Service Workera jest pomijana, mimo bezpiecznego kontekstu", () => {
    // Starsze iOS-y i przegladarki w trybie prywatnym nie maja tego API -
    // odwolanie do `navigator.serviceWorker.register` rzuciloby `TypeError`.
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {});

    expect(() => registerScannerServiceWorker()).not.toThrow();
  });

  it("kontekst NIEZABEZPIECZONY nie probuje rejestrowac", () => {
    // Podglad na `http://` albo na adresie IP w hali: `register()` rzucilby
    // wyjatkiem, a i tak nie ma tam czego przyspieszac.
    for (const secure of [false, undefined, 0, ""]) {
      const register = vi.fn(() => Promise.resolve({}));
      vi.stubGlobal("navigator", { serviceWorker: { register } });
      vi.stubGlobal("isSecureContext", secure);

      registerScannerServiceWorker();

      expect(register).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });
});

describe("straznik zdarzenia instalacji", () => {
  it("ZWYKLE zdarzenie przegladarki nie jest podpowiedzia instalacji", () => {
    // Tak wyglada zdarzenie w przegladarce, ktora nie zna
    // `beforeinstallprompt` - a sluchacz i tak dostanie je pod ta nazwa.
    expect(isInstallPromptEvent(new Event("beforeinstallprompt"))).toBe(false);
    expect(isInstallPromptEvent(new Event("click"))).toBe(false);
  });

  it("zdarzenie z polem `prompt`, ktore NIE jest funkcja, jest odrzucane", () => {
    // Sam klucz nie wystarcza: wywolanie `prompt()` na napisie wywaliloby
    // obsluge klikniecia w przycisk „Zainstaluj".
    for (const prompt of ["prompt", null, undefined, 42, {}, [], true]) {
      const event = Object.assign(new Event("beforeinstallprompt"), { prompt });
      expect(isInstallPromptEvent(event as unknown as Event)).toBe(false);
    }
  });

  it("zdarzenie z WYWOLYWALNYM `prompt` przechodzi i daje sie uzyc", async () => {
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    }) as unknown as Event;

    expect(isInstallPromptEvent(event)).toBe(true);

    // Zwezenie typu ma byc uzyteczne, nie tylko prawdziwe.
    if (isInstallPromptEvent(event)) {
      await event.prompt();
      await expect(event.userChoice).resolves.toEqual({ outcome: "accepted" });
    }
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("`prompt` odziedziczony po prototypie tez przechodzi", () => {
    // Operator `in` chodzi po lancuchu prototypow, wiec zdarzenie opakowane
    // przez przegladarke albo przez warstwe zgodnosci nadal sie kwalifikuje.
    const base = { prompt: () => Promise.resolve() };
    const event = Object.create(base) as unknown as Event;

    expect(isInstallPromptEvent(event)).toBe(true);
  });

  it("straznik poswiadcza WYLACZNIE `prompt`, nie `userChoice`", () => {
    // Stan obecny i swiadomy: brakujace `userChoice` sprawdza dopiero ten,
    // kto na nie czeka. Test trzyma ten zakres na widoku - gdyby straznik
    // zaczal wymagac obu pol, przycisk instalacji zniknalby w przegladarkach,
    // ktore daja tylko `prompt`.
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt: () => Promise.resolve(),
    }) as unknown as Event;

    expect(isInstallPromptEvent(event)).toBe(true);
    expect((event as InstallPromptEvent).userChoice).toBeUndefined();
  });
});

/* ------------------------------------------------ gotowość do pracy offline --- */
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//   * strona prosi workera o zapisanie cudzych adresów albo API - worker
//     staje się pośrednikiem cachującym odpowiedzi bazy (nieaktualne dane
//     wyglądające na prawdziwe);
//   * brak workera albo milczący worker zawiesza kartę gotowości na zawsze
//     zamiast powiedzieć „aplikacja nie jest zapisana";
//   * przeglądarka bez `navigator.storage` wywraca ekran zamiast odpowiedzieć
//     „nie wiadomo".
describe("rozgrzanie cache workera", () => {
  const ORIGIN = "https://nes.example";

  it("do rozgrzania nadaje się tylko powłoka i zasoby budowania z tego samego źródła", async () => {
    const { isScannerPrecacheUrl } = await import("@/lib/events/scannerPwa");
    const ok = ["/scanner", "/_build/a.js", "/assets/b.css", "/scanner/icon-192.png"];
    for (const path of ok) expect(isScannerPrecacheUrl(new URL(path, ORIGIN), ORIGIN)).toBe(true);
    for (const url of [`${ORIGIN}/events/x`, `${ORIGIN}/api/public/y`, "https://obce.example/assets/a.js"]) {
      expect(isScannerPrecacheUrl(new URL(url), ORIGIN)).toBe(false);
    }
  });

  it("lista kandydatów zaczyna się od powłoki, bez powtórzeń i bez nieczytelnych adresów", async () => {
    const { precacheCandidates } = await import("@/lib/events/scannerPwa");
    expect(
      precacheCandidates(
        [`${ORIGIN}/assets/a.js`, `${ORIGIN}/assets/a.js`, "http://[zly", `${ORIGIN}/rest/v1/x`],
        ORIGIN,
      ),
    ).toEqual([`${ORIGIN}/scanner`, `${ORIGIN}/assets/a.js`]);
  });

  function installWorker(onPost: (message: unknown, port: MessagePort) => void) {
    const active = { postMessage: vi.fn((message: unknown, ports: MessagePort[]) => onPost(message, ports[0])) };
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ active }) } });
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: `${window.location.origin}/assets/a.js` } as PerformanceEntry,
    ]);
    return active;
  }

  it("worker odpowiada na kanale - strona dostaje liczbę zapisanych plików", async () => {
    const { requestScannerPrecache } = await import("@/lib/events/scannerPwa");
    const active = installWorker((_message, port) => {
      port.postMessage({ type: "inne" });
      port.postMessage({ type: "precache-done", cached: 2, total: 2 });
    });

    await expect(requestScannerPrecache(1000)).resolves.toEqual({ cached: 2, total: 2 });
    expect(active.postMessage.mock.calls[0][0]).toEqual({
      type: "precache",
      urls: [`${window.location.origin}/scanner`, `${window.location.origin}/assets/a.js`],
    });
  });

  it("milczący worker kończy się `null` po terminie, a nie wiecznym czekaniem", async () => {
    const { requestScannerPrecache } = await import("@/lib/events/scannerPwa");
    installWorker(() => undefined);

    await expect(requestScannerPrecache(20)).resolves.toBeNull();
  });

  it("brak aktywnego workera i brak gotowości w terminie to `null`", async () => {
    const { requestScannerPrecache } = await import("@/lib/events/scannerPwa");
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ active: null }) } });
    await expect(requestScannerPrecache(20)).resolves.toBeNull();

    vi.stubGlobal("navigator", { serviceWorker: { ready: new Promise(() => undefined) } });
    await expect(requestScannerPrecache(20)).resolves.toBeNull();

    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.reject(new Error("x")) } });
    await expect(requestScannerPrecache(20)).resolves.toBeNull();
  });

  it("przeglądarka bez Service Workera albo bez `window` to `null`", async () => {
    const { requestScannerPrecache } = await import("@/lib/events/scannerPwa");
    vi.stubGlobal("navigator", {});
    await expect(requestScannerPrecache()).resolves.toBeNull();
    vi.stubGlobal("window", undefined);
    await expect(requestScannerPrecache()).resolves.toBeNull();
  });
});

describe("trwałe przechowywanie", () => {
  it("odczyt i prośba zwracają odpowiedź przeglądarki", async () => {
    const { requestPersistentStorage, storagePersisted } = await import("@/lib/events/scannerPwa");
    vi.stubGlobal("navigator", {
      storage: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) },
    });

    await expect(storagePersisted()).resolves.toBe(false);
    await expect(requestPersistentStorage()).resolves.toBe(true);
  });

  it("brak API albo odmowa z wyjątkiem to `null`, nie wywrotka ekranu", async () => {
    const { requestPersistentStorage, storagePersisted } = await import("@/lib/events/scannerPwa");
    vi.stubGlobal("navigator", {});
    await expect(storagePersisted()).resolves.toBeNull();
    await expect(requestPersistentStorage()).resolves.toBeNull();

    vi.stubGlobal("navigator", {
      storage: {
        persisted: () => Promise.reject(new Error("SecurityError")),
        persist: () => Promise.reject(new Error("SecurityError")),
      },
    });
    await expect(storagePersisted()).resolves.toBeNull();
    await expect(requestPersistentStorage()).resolves.toBeNull();

    vi.stubGlobal("navigator", undefined);
    await expect(storagePersisted()).resolves.toBeNull();
    await expect(requestPersistentStorage()).resolves.toBeNull();
  });
});
