// Klucze cache sieci kontaktów - IZOLACJA KONTA na poziomie pamięci klienta.
//
// Reguła modułu (nagłówek keys.ts): id użytkownika jest częścią KAŻDEGO klucza,
// żeby zmiana konta nie serwowała cudzej sieci z cache. To nie jest kosmetyka
// nazewnicza - te same RPC zwracają RÓŻNE dane zależnie od tego, kto pyta
// (statusy relacji, zaproszenia, sugestie, liczniki), więc wspólny klucz
// oznaczałby jeden wpis w cache na dwie różne odpowiedzi.
import { describe, expect, it } from "vitest";
import { networkKeys } from "../keys";

describe("networkKeys", () => {
  it("każdy klucz zaczyna się od wspólnego prefiksu (jedno unieważnienie zakresu)", () => {
    const all = [
      networkKeys.statuses("u1", ["a"]),
      networkKeys.connections("u1", ""),
      networkKeys.requests("u1", "in"),
      networkKeys.counts("u1"),
      networkKeys.suggestions("u1"),
    ];
    for (const key of all) {
      expect(key[0]).toBe(networkKeys.all[0]);
    }
  });

  it.each([
    ["statuses", (uid: string | undefined) => networkKeys.statuses(uid, ["a", "b"])],
    ["connections", (uid: string | undefined) => networkKeys.connections(uid, "ala")],
    ["requests", (uid: string | undefined) => networkKeys.requests(uid, "out")],
    ["counts", (uid: string | undefined) => networkKeys.counts(uid)],
    ["suggestions", (uid: string | undefined) => networkKeys.suggestions(uid)],
  ])("%s: dwa konta nigdy nie dzielą wpisu w cache", (_name, build) => {
    expect(build("user-a")).not.toEqual(build("user-b"));
    expect(build("user-a")).toContain("user-a");
  });

  it.each([
    ["statuses", (uid: string | undefined) => networkKeys.statuses(uid, ["a"])],
    ["connections", (uid: string | undefined) => networkKeys.connections(uid, "")],
    ["requests", (uid: string | undefined) => networkKeys.requests(uid, "in")],
    ["counts", (uid: string | undefined) => networkKeys.counts(uid)],
    ["suggestions", (uid: string | undefined) => networkKeys.suggestions(uid)],
  ])('%s: brak zalogowania degraduje do jawnego „anon", nie do undefined', (_n, build) => {
    expect(build(undefined)).toContain("anon");
    expect(build(undefined)).not.toContain(undefined);
  });

  it("statuses: kolejność identyfikatorów nie tworzy nowego wpisu w cache", () => {
    expect(networkKeys.statuses("u1", ["b", "a", "c"])).toEqual(
      networkKeys.statuses("u1", ["a", "c", "b"]),
    );
  });

  it("statuses: inny ZBIÓR identyfikatorów to inny wpis", () => {
    expect(networkKeys.statuses("u1", ["a", "b"])).not.toEqual(networkKeys.statuses("u1", ["a"]));
  });

  it("connections: zapytanie wyszukiwarki jest częścią klucza", () => {
    expect(networkKeys.connections("u1", "ala")).not.toEqual(networkKeys.connections("u1", "ola"));
  });

  it("requests: kierunek rozdziela skrzynki (in ≠ out)", () => {
    expect(networkKeys.requests("u1", "in")).not.toEqual(networkKeys.requests("u1", "out"));
  });
});
