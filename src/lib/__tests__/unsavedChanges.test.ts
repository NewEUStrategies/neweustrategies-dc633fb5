// Maszyna stanów potwierdzenia opuszczenia edytora z niezapisanymi zmianami.
//
// DLACZEGO TO MA TESTY. Ten moduł to JEDYNA zapora między redaktorem a utratą
// napisanego tekstu: gdy autosave nie zdążył, kliknięcie w link ma otworzyć
// pytanie, a nie po cichu wyrzucić z edytora. Do 18.08 siedem funkcji tej
// warstwy (`emit`, `subscribeLeaveConfirmation`, `requestLeaveConfirmation`,
// `resolveLeaveConfirmation` i domknięcia w środku) stało na okrągłym zerze -
// audyt pokrycia policzył 0/7.
//
// STAN JEST MODUŁOWY (jeden store na aplikację, bo dialog żyje w drzewie Reacta
// raz, w __root.tsx, a hook blokera jest bezstanowy). Testy muszą więc same
// sprzątać po sobie - stąd `afterEach`. To nie ozdoba: bez tego jedno
// nierozstrzygnięte żądanie z poprzedniego testu zmieniłoby wynik następnego
// (drugie żądanie odrzuca poprzednie), a suita „udowodniłaby" zachowanie,
// którego nie ma.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestLeaveConfirmation,
  resolveLeaveConfirmation,
  subscribeLeaveConfirmation,
} from "@/lib/unsavedChanges";

afterEach(() => {
  // Domknij ewentualne wiszące pytanie jako „zostaję" (bezpieczny domyślny
  // wybór) i zdejmij nasłuchy - stan modułowy przecieka między testami.
  resolveLeaveConfirmation(false);
});

describe("subscribeLeaveConfirmation", () => {
  it("woła callback NATYCHMIAST stanem bieżącym", () => {
    // Kontrakt hosta: <UnsavedChangesGuardHost /> montuje się raz i musi poznać
    // stan od razu, nie dopiero przy pierwszej zmianie. Inaczej dialog
    // pojawiłby się o jedno zdarzenie za późno.
    const seen = vi.fn();
    const unsubscribe = subscribeLeaveConfirmation(seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(null);
    unsubscribe();
  });

  it("po odsubskrybowaniu callback już nie dostaje zdarzeń", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeLeaveConfirmation(seen);
    seen.mockClear();
    unsubscribe();

    void requestLeaveConfirmation();
    expect(seen).not.toHaveBeenCalled();
  });

  it("odsubskrybowanie jednego nasłuchu nie zabija pozostałych", () => {
    // Edytor wpisu i edytor strony mogą być zamontowane obok siebie; odmontowanie
    // jednego nie może zdjąć zapory drugiemu.
    const zostaje = vi.fn();
    const znika = vi.fn();
    const unsubZostaje = subscribeLeaveConfirmation(zostaje);
    const unsubZnika = subscribeLeaveConfirmation(znika);
    zostaje.mockClear();
    znika.mockClear();

    unsubZnika();
    void requestLeaveConfirmation();

    expect(zostaje).toHaveBeenCalledTimes(1);
    expect(znika).not.toHaveBeenCalled();
    unsubZostaje();
  });

  it("wszyscy subskrybenci widzą ten sam stan", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeLeaveConfirmation(a);
    const unsubB = subscribeLeaveConfirmation(b);
    a.mockClear();
    b.mockClear();

    void requestLeaveConfirmation();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    // Oba dostały NIEPUSTY resolver - czyli oba wiedzą, że jest o co pytać.
    expect(a.mock.calls[0][0]).toBeTypeOf("function");
    expect(b.mock.calls[0][0]).toBe(a.mock.calls[0][0]);
    unsubA();
    unsubB();
  });
});

describe("requestLeaveConfirmation -> resolveLeaveConfirmation", () => {
  it("„wychodzę” rozwiązuje obietnicę na true", async () => {
    const pending = requestLeaveConfirmation();
    resolveLeaveConfirmation(true);
    await expect(pending).resolves.toBe(true);
  });

  it("„zostaję” rozwiązuje obietnicę na false", async () => {
    const pending = requestLeaveConfirmation();
    resolveLeaveConfirmation(false);
    await expect(pending).resolves.toBe(false);
  });

  it("emituje pojawienie się pytania, a potem jego zniknięcie", async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeLeaveConfirmation(seen);
    seen.mockClear();

    const pending = requestLeaveConfirmation();
    // Pierwszy emit: jest resolver -> host renderuje dialog.
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toBeTypeOf("function");

    resolveLeaveConfirmation(true);
    await pending;
    // Drugi emit: null -> host zamyka dialog. Bez tego emitu dialog zostałby na
    // ekranie po decyzji użytkownika.
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[1][0]).toBeNull();

    unsubscribe();
  });

  it("stan wraca do null PRZED rozwiązaniem obietnicy", async () => {
    // Kolejność ma znaczenie: gdyby `resolve` szedł przed zerowaniem stanu,
    // nawigacja mogłaby wystartować, gdy store nadal trzyma resolver - i
    // następne żądanie odrzuciłoby samo siebie jako „poprzednie".
    const stany: Array<unknown> = [];
    const unsubscribe = subscribeLeaveConfirmation((pending) => stany.push(pending));
    stany.length = 0;

    const pending = requestLeaveConfirmation();
    resolveLeaveConfirmation(true);
    await pending;

    expect(stany).toHaveLength(2);
    expect(stany[1]).toBeNull();
    unsubscribe();
  });

  it("resolver dostarczony subskrybentowi rozstrzyga to samo pytanie", async () => {
    // Host nie woła `resolveLeaveConfirmation` - dostaje resolver w callbacku
    // i woła go z przycisku dialogu. Obie drogi muszą być równoważne.
    let resolver: ((leave: boolean) => void) | null = null;
    const unsubscribe = subscribeLeaveConfirmation((pending) => {
      resolver = pending;
    });

    const pending = requestLeaveConfirmation();
    expect(resolver).toBeTypeOf("function");
    resolver!(true);

    await expect(pending).resolves.toBe(true);
    unsubscribe();
  });
});

describe("dwa nakładające się żądania (wyścig blokerów)", () => {
  it("poprzednie pytanie zostaje odrzucone jako „zostaję”, nowe żyje dalej", async () => {
    // Wyścig jest rzadki, ale realny: dwa blokery (np. edytor + dialog
    // potwierdzenia) mogą wystrzelić w jednym tiku. Wybór „zostaję" dla
    // porzuconego pytania jest jedynym bezpiecznym: nawigacja się nie zaczyna,
    // a tekst redaktora zostaje na ekranie.
    const pierwsze = requestLeaveConfirmation();
    const drugie = requestLeaveConfirmation();

    await expect(pierwsze).resolves.toBe(false);

    resolveLeaveConfirmation(true);
    await expect(drugie).resolves.toBe(true);
  });

  it("nie zostawia wiszącego resolvera po porzuconym pytaniu", async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeLeaveConfirmation(seen);
    seen.mockClear();

    const pierwsze = requestLeaveConfirmation();
    const drugie = requestLeaveConfirmation();
    await pierwsze;

    // Rozstrzygnięcie drugiego pytania zeruje stan - gdyby pierwszy resolver
    // przeżył, store trzymałby nieaktualne domknięcie i następny bloker
    // odrzuciłby świeże pytanie.
    resolveLeaveConfirmation(false);
    await drugie;

    expect(seen.mock.calls.at(-1)?.[0]).toBeNull();
    unsubscribe();
  });

  it("trzy żądania pod rząd: dwa pierwsze odrzucone, ostatnie decyduje", async () => {
    const a = requestLeaveConfirmation();
    const b = requestLeaveConfirmation();
    const c = requestLeaveConfirmation();

    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);

    resolveLeaveConfirmation(true);
    await expect(c).resolves.toBe(true);
  });
});

describe("resolveLeaveConfirmation bez wiszącego pytania", () => {
  it("jest bezpiecznym no-op, nie rzuca", () => {
    // Host może zamknąć dialog (onOpenChange) po tym, jak pytanie zostało już
    // rozstrzygnięte klawiaturą - drugie wywołanie nie ma prawa wysypać apki.
    expect(() => resolveLeaveConfirmation(true)).not.toThrow();
    expect(() => resolveLeaveConfirmation(false)).not.toThrow();
  });

  it("nie emituje zdarzenia, gdy nie było czego rozstrzygać", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeLeaveConfirmation(seen);
    seen.mockClear();

    resolveLeaveConfirmation(true);

    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("podwójne rozstrzygnięcie tego samego pytania rozwiązuje obietnicę raz", async () => {
    const pending = requestLeaveConfirmation();
    resolveLeaveConfirmation(true);
    // Drugie kliknięcie w ten sam przycisk (albo zamknięcie dialogu po decyzji).
    expect(() => resolveLeaveConfirmation(false)).not.toThrow();
    // Pierwsza decyzja obowiązuje - obietnica JS i tak jest jednorazowa, ale
    // liczy się, że drugie wywołanie nie odwraca wyniku ani nie rzuca.
    await expect(pending).resolves.toBe(true);
  });
});
