// „Kto jeszcze edytuje ten wpis?" - `useEditPresence` (0 z 1 funkcji przed tą
// zmianą; audyt wymienił obecność edytorską jako całą funkcjonalność MODUŁU 2
// stojącą na okrągłym zerze).
//
// Hook jest CIENKĄ NAKŁADKĄ na uogólnione `useEntityPresence` z lib/realtime,
// zachowaną dla zgodności wstecznej edytorów wpisów i stron. Test jest więc
// testem KONTRAKTU DELEGACJI, nie testem realtime: pilnuje, że nakładka
// przekazuje typ i id encji BEZ ZMIANY i oddaje wynik bez filtrowania.
//
// Dlaczego to warte testu, mimo że to jedna linia: obecność jest funkcją
// PRYWATNOŚCI. Topic kanału powstaje z `entityType:entityId`, a przekręcenie
// tych argumentów (albo dołożenie „poprawki" w nakładce) wpuściłoby edytora
// wpisu na kanał STRONY o tym samym id - czyli pokazałoby nazwiska osób
// pracujących nad innym dokumentem. Osobny test dowodzi też, że nakładka NIE
// dokłada żadnej własnej logiki, bo cała reguła (wykluczenie siebie, sortowanie)
// należy do `useEntityPresence` i tam ma być utrzymywana.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  calls: [] as Array<[unknown, unknown]>,
  peers: [] as Array<{ userId: string; name: string; sinceIso: string }>,
}));

vi.mock("@/lib/realtime/useEntityPresence", () => ({
  useEntityPresence: (entityType: unknown, entityId: unknown) => {
    h.calls.push([entityType, entityId]);
    return h.peers;
  },
}));

import { useEditPresence } from "@/hooks/useEditPresence";

beforeEach(() => {
  h.calls = [];
  h.peers = [];
});

describe("useEditPresence", () => {
  it("przekazuje typ i id encji BEZ ZMIANY", () => {
    // Topic kanału realtime powstaje z tych dwóch wartości. Przekręcenie ich
    // wpuściłoby edytora wpisu na kanał strony o tym samym id.
    renderHook(() => useEditPresence("post", "post-1"));
    expect(h.calls).toEqual([["post", "post-1"]]);
  });

  it("obsługuje oba typy encji edytora", () => {
    renderHook(() => useEditPresence("page", "page-7"));
    expect(h.calls).toEqual([["page", "page-7"]]);
  });

  it("brak id (wpis jeszcze nieutworzony) przechodzi dalej jako brak", () => {
    // `useEntityPresence` sam pilnuje, żeby nie otwierać kanału bez id -
    // nakładka nie ma prawa podstawiać pustego stringa, bo powstałby topic
    // `presence:<tenant>:post:` wspólny dla WSZYSTKICH nowych wpisów tenanta.
    renderHook(() => useEditPresence("post", null));
    expect(h.calls).toEqual([["post", null]]);

    h.calls = [];
    renderHook(() => useEditPresence("post", undefined));
    expect(h.calls).toEqual([["post", undefined]]);
  });

  it("oddaje listę współedytorów BEZ filtrowania ani sortowania od siebie", () => {
    // Cała reguła (wykluczenie siebie, kolejność od najstarszego) należy do
    // `useEntityPresence`. Powtórzenie jej tutaj dałoby dwa miejsca do
    // utrzymywania i rozjazd przy pierwszej zmianie.
    h.peers = [
      { userId: "user-b", name: "Barbara", sinceIso: "2026-08-18T10:00:00.000Z" },
      { userId: "user-a", name: "Adam", sinceIso: "2026-08-18T09:00:00.000Z" },
    ];
    const { result } = renderHook(() => useEditPresence("post", "post-1"));
    expect(result.current).toBe(h.peers);
  });

  it("brak innych edytorów to pusta lista, nie null", () => {
    // Panel obecności renderuje `.map()` na tej wartości.
    const { result } = renderHook(() => useEditPresence("post", "post-1"));
    expect(result.current).toEqual([]);
  });
});
