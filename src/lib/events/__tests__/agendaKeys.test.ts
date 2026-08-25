// Kształt kluczy cache agendy.
//
// DLACZEGO TEN TEST ISTNIEJE. Klucz szczegółu sesji NIE leży pod gałęzią
// wydarzenia (`["event-agenda", "session", id]` kontra
// `["event-agenda", eventId, …]`), więc unieważnienie po zapisie musi trafić
// w oba przedrostki. Zależność jest niewidoczna w miejscu wywołania: kod
// unieważniający wygląda poprawnie także wtedy, gdy pomija połowę drzewa,
// a skutkiem jest dialog pokazujący wartość sprzed zapisu i odsyłający ją
// z powrotem do bazy. Test przypina tę relację, żeby zmiana kształtu klucza
// oblała się TUTAJ, a nie w danych organizatora.
import { describe, expect, it } from "vitest";
import { agendaKeys } from "@/lib/events/useEventSessions";

const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Odwzorowanie dopasowania TanStack Query: klucz pasuje po PRZEDROSTKU. */
function hasPrefix(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((part, index) => Object.is(key[index], part));
}

describe("agendaKeys", () => {
  it("szczegół sesji NIE leży pod gałęzią wydarzenia", () => {
    expect(hasPrefix(agendaKeys.session(SESSION), agendaKeys.event(EVENT))).toBe(false);
  });

  it("przedrostek użyty przy unieważnianiu obejmuje szczegół i zapisy", () => {
    const prefix = [...agendaKeys.all, "session"] as const;
    expect(hasPrefix(agendaKeys.session(SESSION), prefix)).toBe(true);
    expect(hasPrefix(agendaKeys.signups(SESSION), prefix)).toBe(true);
  });

  it("listy sesji leżą pod gałęzią wydarzenia, więc jedno unieważnienie im starczy", () => {
    const query = { eventId: EVENT, status: "all", trackId: null, roomId: null, q: "" } as const;
    expect(hasPrefix(agendaKeys.sessions(query), agendaKeys.event(EVENT))).toBe(true);
    expect(hasPrefix(agendaKeys.tracks(EVENT), agendaKeys.event(EVENT))).toBe(true);
    expect(hasPrefix(agendaKeys.rooms(EVENT), agendaKeys.event(EVENT))).toBe(true);
  });

  it("klucz wyłączonego zapytania jest stabilny i nie udaje wydarzenia", () => {
    expect(agendaKeys.sessions(null)).toEqual([...agendaKeys.all, "sessions", "idle"]);
  });
});
