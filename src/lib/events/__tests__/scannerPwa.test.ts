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
