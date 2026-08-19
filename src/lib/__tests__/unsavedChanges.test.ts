// Kolejka potwierdzeń wyjścia z edytora. Wszystkie pięć funkcji tego modułu
// stało do tej pory bez ANI JEDNEGO wywołania w teście, mimo że decydują
// o tym, czy redaktor zdąży zobaczyć pytanie „masz niezapisane zmiany"
// zanim router go stąd zabierze - a więc czy praca przepadnie.
//
// Moduł trzyma stan na poziomie MODUŁU (jeden dialog na aplikację), więc każdy
// przypadek musi po sobie posprzątać - inaczej zawisłe żądanie przecieka
// do następnego testu i „dowodzi" czegoś, czego nie ma.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestLeaveConfirmation,
  resolveLeaveConfirmation,
  subscribeLeaveConfirmation,
} from "../unsavedChanges";

afterEach(() => {
  // Domknij ewentualne zawisłe żądanie (no-op, gdy nic nie czeka).
  resolveLeaveConfirmation(false);
});

describe("subscribeLeaveConfirmation", () => {
  it("odtwarza BIEŻĄCY stan nowemu subskrybentowi natychmiast", () => {
    // Host dialogu montuje się w drzewie Reacta, a blokada routera może paść
    // wcześniej. Bez tego natychmiastowego wywołania host nigdy by się nie
    // dowiedział o żądaniu, które już czeka - i dialog by się nie pokazał.
    const seen: Array<unknown> = [];
    const unsub = subscribeLeaveConfirmation((pending) => seen.push(pending));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeNull();
    unsub();
  });

  it("odtwarza ZAWISŁE żądanie subskrybentowi, który podpiął się później", async () => {
    const promise = requestLeaveConfirmation();
    const seen: Array<unknown> = [];
    const unsub = subscribeLeaveConfirmation((pending) => seen.push(pending));

    expect(seen).toHaveLength(1);
    expect(typeof seen[0]).toBe("function");

    resolveLeaveConfirmation(true);
    await expect(promise).resolves.toBe(true);
    unsub();
  });

  it("powiadamia WSZYSTKICH subskrybentów o zmianie stanu", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeLeaveConfirmation(a);
    const unsubB = subscribeLeaveConfirmation(b);
    a.mockClear();
    b.mockClear();

    const promise = requestLeaveConfirmation();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    resolveLeaveConfirmation(false);
    await promise;
    unsubA();
    unsubB();
  });

  it("po odsubskrybowaniu nie dostaje już powiadomień", async () => {
    const cb = vi.fn();
    const unsub = subscribeLeaveConfirmation(cb);
    unsub();
    cb.mockClear();

    const promise = requestLeaveConfirmation();
    expect(cb).not.toHaveBeenCalled();

    resolveLeaveConfirmation(false);
    await promise;
  });

  it("odsubskrybowanie jednego nasłuchu nie zdejmuje pozostałych", async () => {
    const stays = vi.fn();
    const goes = vi.fn();
    const unsubStays = subscribeLeaveConfirmation(stays);
    const unsubGoes = subscribeLeaveConfirmation(goes);
    unsubGoes();
    stays.mockClear();
    goes.mockClear();

    const promise = requestLeaveConfirmation();
    expect(stays).toHaveBeenCalledTimes(1);
    expect(goes).not.toHaveBeenCalled();

    resolveLeaveConfirmation(false);
    await promise;
    unsubStays();
  });
});

describe("requestLeaveConfirmation", () => {
  it("rozwiązuje się wartością wybraną przez użytkownika", async () => {
    const leave = requestLeaveConfirmation();
    resolveLeaveConfirmation(true);
    await expect(leave).resolves.toBe(true);

    const stay = requestLeaveConfirmation();
    resolveLeaveConfirmation(false);
    await expect(stay).resolves.toBe(false);
  });

  it("nie rozwiązuje się, dopóki nikt nie odpowiedział", async () => {
    const promise = requestLeaveConfirmation();
    const race = await Promise.race([promise, Promise.resolve("wciąż-czeka")]);
    expect(race).toBe("wciąż-czeka");
    resolveLeaveConfirmation(false);
    await promise;
  });

  it("drugie żądanie odrzuca pierwsze jako „zostań”, zamiast zgubić resolver", async () => {
    // Wyścig dwóch blokad (np. edytor i osadzony builder naraz). Gdyby pierwszy
    // resolver po prostu przepadł, jego `await` nigdy by się nie rozwiązał,
    // a nawigacja zawisłaby na zawsze - z perspektywy redaktora panel
    // przestałby reagować na kliknięcia w menu.
    const first = requestLeaveConfirmation();
    const second = requestLeaveConfirmation();

    await expect(first).resolves.toBe(false);

    resolveLeaveConfirmation(true);
    await expect(second).resolves.toBe(true);
  });

  it("po rozwiązaniu czyści stan, więc kolejne żądanie startuje od zera", async () => {
    const seen: Array<unknown> = [];
    const unsub = subscribeLeaveConfirmation((pending) => seen.push(pending));

    const promise = requestLeaveConfirmation();
    resolveLeaveConfirmation(true);
    await promise;

    // subskrypcja (null) -> żądanie (funkcja) -> rozwiązanie (null)
    expect(seen[0]).toBeNull();
    expect(typeof seen[1]).toBe("function");
    expect(seen.at(-1)).toBeNull();
    unsub();
  });
});

describe("resolveLeaveConfirmation", () => {
  it("bez zawisłego żądania jest no-opem, nie wyjątkiem", () => {
    // Host dialogu może zostać odmontowany po tym, jak żądanie już domknięto
    // (podwójny klik, zamknięcie karty w trakcie animacji) - druga odpowiedź
    // nie może wywrócić aplikacji.
    expect(() => resolveLeaveConfirmation(true)).not.toThrow();
    expect(() => resolveLeaveConfirmation(false)).not.toThrow();
  });

  it("druga odpowiedź na to samo żądanie nie zmienia już wyniku", async () => {
    const promise = requestLeaveConfirmation();
    resolveLeaveConfirmation(true);
    resolveLeaveConfirmation(false);
    await expect(promise).resolves.toBe(true);
  });
});
