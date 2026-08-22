// @vitest-environment node
//
// Strażnik SSR listy gościa.
//
// PO CO OSOBNY PLIK ZE ŚRODOWISKIEM `node`. `readGuestSaved` zaczyna się od
// `typeof window === "undefined"`. W happy-dom ta gałąź jest NIEOSIĄGALNA -
// okno istnieje zawsze - więc w pliku obok stała jako jedyna niepokryta
// i wyglądała na dług, którym nie jest.
//
// CO SIĘ STANIE BEZ NIEJ: lista czytelnicza jest importowana przez trasę
// `/reading-list`, która renderuje się na serwerze. Sięgnięcie po
// `localStorage` na serwerze to ReferenceError w RENDERZE, czyli HTTP 500 na
// stronie - nie „pusta lista".
//
// Lista gościa jest z definicji per urządzenie, więc pusta lista na serwerze
// jest jedyną poprawną odpowiedzią - nie ma czego czytać.
import { describe, expect, it } from "vitest";

import { readGuestSaved } from "../guestSaved";

describe("bez przeglądarki", () => {
  it("kanarek środowiska: brak `window`", () => {
    // Bez tego cały plik mógłby przejść w happy-dom, nie dowodząc niczego.
    expect(typeof window).toBe("undefined");
  });

  it("`readGuestSaved` zwraca pustą listę i nie rzuca", () => {
    expect(() => readGuestSaved()).not.toThrow();
    expect(readGuestSaved()).toEqual([]);
  });
});
