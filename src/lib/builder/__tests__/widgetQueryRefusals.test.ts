// ODMOWY I PUSTKI w zapytaniach widgetow wydarzen, spotkan, tickera i slidera.
//
// Cztery moduly, cztery ROZNE rozstrzygniecia tego samego pytania: co zrobic,
// gdy baza odmawia albo gdy filtr nie trafia w nic. Rozstrzygniecia sa
// przeciwstawne z premedytacja - i zadne nie jest wyrazone w typach:
//
//   * `eventsQuery` i `meetingsQuery` RZUCAJA (lista wydarzen, ktora po cichu
//     zamieniła by odmowe w "brak wydarzen", klamie czytelnikowi o programie);
//   * `newsTickerQuery` i `sliderPostsQuery` POLYKAJA (pasek i hero maja
//     wtedy zniknac, a nie wywrocic strone bledem sekcji).
//
// Do tego dwie rzeczy, ktore sa CZESCIA KLUCZA i dlatego zmieniaja wynik
// widgetu, choc wygladaja na detal:
//   1. `viewerId` w kluczu slotow - flagi `booked_by_me` / `is_mine` sa
//      per-uzytkownik, wiec wylogowanie MUSI dac inny wpis cache;
//   2. "teraz" NIE jest czescia klucza listy wydarzen - znacznik czasu bierze
//      sie w `queryFn`, inaczej prefetch SSR i klient renderowaly by dwa
//      rozne klucze i sekcja fetchowala by sie drugi raz po hydratacji.
//
// Wszystkie zapytania odpalane sa publicznym wejsciem (`...QueryOptions()
// .queryFn()`), dokladnie tak jak zrobilby to react-query. `edgeTtlCache`
// (ssrCache.ts:91) pod happy-dom przepuszcza fetcher bez cache'owania, wiec
// kazde wywolanie realnie schodzi do atrapy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedChain, SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  sb.from = fromStub;
  sb.rpc = rpcStub;
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});

import { fail, ok } from "@/test/supabase";
import type { WidgetContent } from "@/lib/builder/types";
import {
  eventByIdQueryOptions,
  eventRsvpCountsQueryOptions,
  eventsListQueryOptions,
  type EventRsvpCount,
} from "@/lib/builder/eventsQuery";
import {
  bookMeetingSlot,
  cancelMyMeetingBooking,
  createMyMeetingSlot,
  deleteMyMeetingSlot,
  meetingSlotsQueryOptions,
  type MeetingSlotRow,
} from "@/lib/builder/meetingsQuery";
import { newsTickerQueryOptions, type TickerPost } from "@/lib/builder/newsTickerQuery";
import {
  sliderPostsQueryOptions,
  sliderUsesPostsSource,
  type SliderPostRow,
} from "@/lib/builder/sliderPostsQuery";

const db = (): SupabaseFromStub => {
  if (!sb.from) throw new Error("atrapa `from` nie zostala zamontowana");
  return sb.from;
};
const rpc = (): SupabaseRpcStub => {
  if (!sb.rpc) throw new Error("atrapa `rpc` nie zostala zamontowana");
  return sb.rpc;
};

/** Uruchamia `queryFn` fabryki tak, jak zrobilby to react-query. */
async function run<T>(options: { queryFn?: unknown }): Promise<T> {
  const fn = options.queryFn as () => Promise<T>;
  return fn();
}

/** Kierunek sortowania zapisany w ogniwie `.order`. */
function ascendingOf(chain: RecordedChain | undefined): boolean | undefined {
  const args = chain?.argsOf("order");
  return (args?.[1] as { ascending?: boolean } | undefined)?.ascending;
}

beforeEach(() => {
  db().reset();
  rpc().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("lista wydarzen: trzy zakresy czasu", () => {
  it("upcoming pyta o przyszlosc rosnaco, past o przeszlosc malejaco, all bez filtra czasu", async () => {
    db().setResponse("events", () => ok([]));

    await run(eventsListQueryOptions({ scope: "upcoming" }, "pl"));
    const upcoming = db().lastChain("events");
    expect(upcoming?.has("gte")).toBe(true);
    expect(upcoming?.has("lt")).toBe(false);
    expect(ascendingOf(upcoming)).toBe(true);

    await run(eventsListQueryOptions({ scope: "past" }, "pl"));
    const past = db().lastChain("events");
    expect(past?.has("lt")).toBe(true);
    expect(past?.has("gte")).toBe(false);
    expect(ascendingOf(past)).toBe(false);

    await run(eventsListQueryOptions({ scope: "all" }, "pl"));
    const all = db().lastChain("events");
    expect(all?.has("gte")).toBe(false);
    expect(all?.has("lt")).toBe(false);
    expect(ascendingOf(all)).toBe(false);
  });

  it("znacznik 'teraz' bierze sie w queryFn, a NIE w kluczu zapytania", async () => {
    // Gdyby "teraz" wchodzilo do klucza, prefetch SSR i render klienta
    // wyliczaly by dwa rozne klucze i sekcja fetchowala sie drugi raz po
    // hydratacji - przy kazdym wejsciu na strone.
    db().setResponse("events", () => ok([]));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));

    const wczesniej = eventsListQueryOptions({ scope: "upcoming" }, "pl");
    await run(wczesniej);
    expect(db().lastChain("events")?.argsOf("gte")?.[1]).toBe("2026-03-01T12:00:00.000Z");

    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    const pozniej = eventsListQueryOptions({ scope: "upcoming" }, "pl");
    await run(pozniej);
    expect(db().lastChain("events")?.argsOf("gte")?.[1]).toBe("2026-06-01T12:00:00.000Z");

    // Klucz sie NIE zmienil, mimo trzech miesiecy roznicy.
    expect(pozniej.queryKey).toEqual(wczesniej.queryKey);
  });

  it("rodzaj wydarzenia doklada ogniwo tylko wtedy, gdy jest z bialej listy", async () => {
    db().setResponse("events", () => ok([]));

    await run(eventsListQueryOptions({ kind: "webinar" }, "pl"));
    expect(db().lastChain("events")?.argsOf("eq")).toBeDefined();
    expect(
      db()
        .lastChain("events")
        ?.calls.filter((c) => c.method === "eq"),
    ).toHaveLength(2);

    await run(eventsListQueryOptions({ kind: "" }, "pl"));
    // Zostaje samo `.eq("status","published")`.
    expect(
      db()
        .lastChain("events")
        ?.calls.filter((c) => c.method === "eq"),
    ).toHaveLength(1);
  });

  it("odmowa odczytu wydarzen RZUCA, a brak wierszy daje pusta liste", async () => {
    // Pusta lista przy odmowie byla by klamstwem o programie - czytelnik
    // zobaczylby "brak wydarzen" tam, gdzie sa wydarzenia.
    db().setResponse("events", () => fail("permission denied for table events", "42501"));
    await expect(run(eventsListQueryOptions({}, "pl"))).rejects.toThrow(/permission denied/);

    db().setResponse("events", () => ok(null));
    await expect(run(eventsListQueryOptions({}, "pl"))).resolves.toEqual([]);
  });
});

describe("jedno wydarzenie po id", () => {
  it("pusty identyfikator NIE puka do bazy", async () => {
    await expect(run(eventByIdQueryOptions(""))).resolves.toBeNull();
    expect(db().chains).toHaveLength(0);
  });

  it("wydarzenie nieznalezione daje null, a odmowa RZUCA", async () => {
    db().setResponse("events", () => ok(null));
    await expect(run(eventByIdQueryOptions("e-1"))).resolves.toBeNull();

    db().setResponse("events", () => fail("permission denied", "42501"));
    await expect(run(eventByIdQueryOptions("e-1"))).rejects.toThrow(/permission denied/);
  });
});

describe("liczniki RSVP", () => {
  it("pusta lista wydarzen omija RPC i daje pusta mape", async () => {
    const wynik = await run<Map<string, EventRsvpCount>>(eventRsvpCountsQueryOptions([]));
    expect(wynik.size).toBe(0);
    expect(rpc().calls).toHaveLength(0);
  });

  it("klucz deduplikuje i sortuje identyfikatory - kolejnosc kart nie unieważnia cache", () => {
    expect(eventRsvpCountsQueryOptions(["b", "a", "b"]).queryKey[1]).toEqual(["a", "b"]);
  });

  it("liczniki null i ujemne sa zaciskane do zera, a nie przepuszczane", async () => {
    rpc().setData("get_event_rsvp_counts", [
      { event_id: "e-1", going: null, interested: -3 },
      { event_id: "e-2", going: 4, interested: 2 },
      // Brak KLUCZA (a nie null) - inny ksztalt odpowiedzi, ta sama zerowka.
      { event_id: "e-3" },
    ]);

    const wynik = await run<Map<string, EventRsvpCount>>(
      eventRsvpCountsQueryOptions(["e-1", "e-2"]),
    );

    expect(wynik.get("e-1")).toEqual({ going: 0, interested: 0 });
    expect(wynik.get("e-2")).toEqual({ going: 4, interested: 2 });
    expect(wynik.get("e-3")).toEqual({ going: 0, interested: 0 });
  });

  it("odmowa RPC licznikow RZUCA, a brak wierszy daje pusta mape", async () => {
    rpc().setError("get_event_rsvp_counts", "permission denied for function", "42501");
    await expect(run(eventRsvpCountsQueryOptions(["e-1"]))).rejects.toThrow(/permission denied/);

    rpc().setData("get_event_rsvp_counts", null);
    const wynik = await run<Map<string, EventRsvpCount>>(eventRsvpCountsQueryOptions(["e-1"]));
    expect(wynik.size).toBe(0);
  });
});

describe("sloty spotkan", () => {
  it("viewerId JEST czescia klucza - wylogowanie musi zmienic wpis cache", () => {
    const anonim = meetingSlotsQueryOptions({ mode: "host", hostUserId: "u-1" }, null);
    const zalogowany = meetingSlotsQueryOptions({ mode: "host", hostUserId: "u-1" }, "u-9");

    expect(anonim.queryKey.at(-1)).toBe("anon");
    expect(zalogowany.queryKey.at(-1)).toBe("u-9");
    expect(anonim.queryKey).not.toEqual(zalogowany.queryKey);
  });

  it("widget NIESKONFIGUROWANY oddaje pusta liste bez ANI JEDNEGO wywolania RPC", async () => {
    // Regresja "pusty widget pokazuje caly katalog" jest kosztowna i cicha:
    // przy braku hosta serwer nie moze zamiast tego pokazac wszystkich slotow.
    await expect(run(meetingSlotsQueryOptions({ mode: "host" }, null))).resolves.toEqual([]);
    await expect(run(meetingSlotsQueryOptions({ mode: "event" }, null))).resolves.toEqual([]);
    expect(rpc().calls).toHaveLength(0);
  });

  it("tryb host zeruje p_event_id, tryb event zeruje p_host_user_id", async () => {
    rpc().setData("get_public_meeting_slots", []);

    await run(meetingSlotsQueryOptions({ mode: "host", hostUserId: "u-1" }, null));
    expect(rpc().lastCall("get_public_meeting_slots")?.arg("p_host_user_id")).toBe("u-1");
    expect(rpc().lastCall("get_public_meeting_slots")?.arg("p_event_id")).toBeNull();

    await run(meetingSlotsQueryOptions({ mode: "event", eventId: "e-1" }, null));
    expect(rpc().lastCall("get_public_meeting_slots")?.arg("p_host_user_id")).toBeNull();
    expect(rpc().lastCall("get_public_meeting_slots")?.arg("p_event_id")).toBe("e-1");
  });

  it("odmowa RPC RZUCA komunikatem SERWERA, a smieci w odpowiedzi sa odsiewane", async () => {
    rpc().setError("get_public_meeting_slots", "insufficient capability");
    await expect(
      run(meetingSlotsQueryOptions({ mode: "host", hostUserId: "u-1" }, null)),
    ).rejects.toThrow("insufficient capability");

    // Wiersz bez `id` nie jest slotem - nie da sie go zarezerwowac ani odwolac.
    rpc().setData("get_public_meeting_slots", [
      { id: "" },
      { id: "s-1", host_user_id: "u-1" },
      null,
      "x",
      [],
    ]);
    const rows = await run<MeetingSlotRow[]>(
      meetingSlotsQueryOptions({ mode: "host", hostUserId: "u-1" }, null),
    );
    expect(rows.map((r) => r.id)).toEqual(["s-1"]);

    rpc().setData("get_public_meeting_slots", null);
    await expect(
      run(meetingSlotsQueryOptions({ mode: "host", hostUserId: "u-1" }, null)),
    ).resolves.toEqual([]);
  });

  it("cztery mutacje slotow propaguja komunikat SERWERA, nie generyczny", async () => {
    const przypadki: Array<[string, () => Promise<void>, string]> = [
      ["book_meeting_slot", () => bookMeetingSlot("s-1"), "slot already booked"],
      ["cancel_my_meeting_booking", () => cancelMyMeetingBooking("s-1"), "booking not found"],
      [
        "create_my_meeting_slot",
        () =>
          createMyMeetingSlot({
            startsAt: "2026-10-12T09:00:00Z",
            endsAt: "2026-10-12T09:30:00Z",
            eventId: null,
            location: null,
          }),
        "overlapping slot",
      ],
      ["delete_my_meeting_slot", () => deleteMyMeetingSlot("s-1"), "slot is booked"],
    ];

    for (const [nazwa, wywolanie, komunikat] of przypadki) {
      rpc().setError(nazwa, komunikat);
      await expect(wywolanie()).rejects.toThrow(komunikat);

      rpc().setData(nazwa, null);
      await expect(wywolanie()).resolves.toBeUndefined();
    }
  });

  it("rezerwacja bez notatki wysyla p_note === null, a nie undefined", async () => {
    // `undefined` w argumencie RPC znaczy "uzyj DEFAULT serwera", co jest INNA
    // odpowiedzia niz jawny brak notatki.
    rpc().setData("book_meeting_slot", null);

    await bookMeetingSlot("s-1");
    expect(rpc().lastCall("book_meeting_slot")?.arg("p_note")).toBeNull();

    await bookMeetingSlot("s-1", "do zobaczenia");
    expect(rpc().lastCall("book_meeting_slot")?.arg("p_note")).toBe("do zobaczenia");
  });
});

describe("pasek aktualnosci: filtr kategorii i autorzy", () => {
  it("slug nietrafiajacy w zadna kategorie konczy sie [] BEZ zapytania o posty", async () => {
    db().setResponse("categories", () => ok([]));

    await expect(
      run(newsTickerQueryOptions({ categoriesCsv: "nieistniejaca" }, "pl")),
    ).resolves.toEqual([]);
    expect(db().lastChain("posts")).toBeUndefined();
  });

  it("kategoria bez powiazanych postow tez konczy sie [] BEZ zapytania o posty", async () => {
    db().setResponse("categories", () => ok([{ id: "c-1" }]));
    db().setResponse("post_categories", () => ok([]));

    await expect(run(newsTickerQueryOptions({ categoriesCsv: "ue" }, "pl"))).resolves.toEqual([]);
    expect(db().lastChain("posts")).toBeUndefined();
  });

  it("brak wierszy (data null) w kategoriach i w powiazaniach tez konczy sie []", async () => {
    // `null` to inna odpowiedz niz pusta tablica (tak wyglada odmowa odczytu
    // bez rzucania), a skutek dla widgetu musi byc ten sam.
    db().setResponse("categories", () => ok(null));
    await expect(run(newsTickerQueryOptions({ categoriesCsv: "ue" }, "pl"))).resolves.toEqual([]);

    db().setResponse("categories", () => ok([{ id: "c-1" }]));
    db().setResponse("post_categories", () => ok(null));
    await expect(run(newsTickerQueryOptions({ categoriesCsv: "ue" }, "pl"))).resolves.toEqual([]);
    expect(db().lastChain("posts")).toBeUndefined();
  });

  it("trafiony filtr kategorii ZAWEZA zapytanie o posty ogniwem .in", async () => {
    db().setResponse("categories", () => ok([{ id: "c-1" }]));
    db().setResponse("post_categories", () => ok([{ post_id: "p-1" }, { post_id: "p-1" }]));
    db().setResponse("posts", () => ok([]));

    await run(newsTickerQueryOptions({ categoriesCsv: "ue" }, "pl"));

    // Powtorzone powiazanie liczy sie raz - zbior, nie lista.
    expect(db().lastChain("posts")?.argsOf("in")).toEqual(["id", ["p-1"]]);
  });

  it("bez csv kategorii zapytanie o kategorie w ogole nie leci", async () => {
    db().setResponse("posts", () => ok([]));

    await run(newsTickerQueryOptions({}, "pl"));

    expect(db().lastChain("categories")).toBeUndefined();
    expect(db().lastChain("posts")).toBeDefined();
  });

  it("odmowa odczytu postow udaje PUSTY ticker - swiadomie, bo pasek ma zniknac", async () => {
    // Nazwa zapisuje POWOD: `fetchTickerPosts` nie czyta `error` na zapytaniu
    // o posty (newsTickerQuery.ts:89). Pusty pasek jest poprawnym stanem
    // widgetu, a rzucenie wywrocilo by chrome naglowka na KAZDEJ trasie.
    db().setResponse("posts", () => fail("permission denied for table posts", "42501"));

    await expect(run(newsTickerQueryOptions({}, "pl"))).resolves.toEqual([]);
  });

  it("brak author_id we wszystkich wpisach omija zapytanie o profile", async () => {
    db().setResponse("posts", () => ok([{ id: "p-1", slug: "a", author_id: null }]));

    await run(newsTickerQueryOptions({}, "pl"));

    expect(db().lastChain("profiles")).toBeUndefined();
  });

  it("autor bez wiersza profilu daje null, a nie pusty napis - i odmowa tez", async () => {
    db().setResponse("posts", () => ok([{ id: "p-1", slug: "a", author_id: "u-1" }]));

    db().setResponse("profiles", () => ok([]));
    const brakWiersza = await run<TickerPost[]>(newsTickerQueryOptions({}, "pl"));
    expect(brakWiersza[0].author_display_name).toBeNull();
    expect(brakWiersza[0].author_avatar_url).toBeNull();

    db().setResponse("profiles", () => fail("permission denied", "42501"));
    const odmowa = await run<TickerPost[]>(newsTickerQueryOptions({}, "pl"));
    expect(odmowa[0].author_display_name).toBeNull();
    expect(odmowa[0].author_avatar_url).toBeNull();
  });

  it("znaleziony profil autora dokleja nazwisko i awatar do wpisu tickera", async () => {
    db().setResponse("posts", () =>
      ok([
        { id: "p-1", slug: "a", author_id: "u-1" },
        { id: "p-2", slug: "b", author_id: null },
      ]),
    );
    db().setResponse("profiles", () =>
      ok([{ id: "u-1", display_name: "Jan Przykladowy", avatar_url: "https://example.com/a.png" }]),
    );

    const rows = await run<TickerPost[]>(newsTickerQueryOptions({}, "pl"));

    expect(rows[0].author_display_name).toBe("Jan Przykladowy");
    expect(rows[0].author_avatar_url).toBe("https://example.com/a.png");
    // Wpis bez autora zostaje bez byline - i nie pozycza go od sasiada.
    expect(rows[1].author_display_name).toBeNull();
    // O profile pytamy RAZ, po zdeduplikowanej liscie identyfikatorow.
    expect(db().lastChain("profiles")?.argsOf("in")).toEqual(["id", ["u-1"]]);
  });

  // DEFEKT: TICKER CZYTA TABELE `profiles`, A NIE WIDOK `profiles_public`.
  //
  // WEJSCIE: pasek aktualnosci w chrome naglowka (a wiec na KAZDEJ trasie
  //   publicznej) z wpisami, ktore maja `author_id`.
  // CO PSUJE: `fetchTickerPosts` (src/lib/builder/newsTickerQuery.ts:98) siega
  //   po `supabase.from("profiles")`, podczas gdy trzy siostrzane moduly tego
  //   samego wiersza - `postListQuery` (`attachAuthorNames`), `ratedListQuery`
  //   i `sliderAuthorsQuery` - czytaja WIDOK `profiles_public`. Widok jest
  //   zawezony do `public_tenant_id()` i wystawia wylacznie kolumny publiczne;
  //   tabela bazowa takiego zawezenia nie ma WPISANEGO W SIEBIE - jej izolacja
  //   zalezy od polityk RLS `profiles`, czyli od zupelnie innego pliku migracji
  //   niz ten, ktory chroni pozostale trzy zapytania.
  // KONSEKWENCJA: izolacja najemcy dla nazwiska i awatara autora w tickerze
  //   opiera sie na innym mechanizmie niz dla tych samych danych w post-liscie.
  //   Rozjazd jest niewidoczny w typach (oba ksztalty wiersza sa identyczne)
  //   i niewidoczny w interfejsie (pasek pokazuje nazwisko tak samo), wiec
  //   zmiana polityki `profiles` moze rozszerzyc widocznosc TYLKO w tickerze
  //   i nikt tego nie zauwazy. Do tego `profiles` wystawia kolumny prywatne,
  //   ktorych widok publiczny nie ma - selekcja trzech kolumn jest jedynym,
  //   co dzieli to zapytanie od odczytu danych kontaktowych autora.
  // WYMAGANA POPRAWKA: przepiac odczyt na `profiles_public` (te same trzy
  //   kolumny: `id, display_name, avatar_url`), tak by wszystkie cztery
  //   zapytania widgetowe czytajace autora szly przez JEDEN widok - wtedy
  //   izolacja najemcy jest wlasnoscia widoku, a nie sumy czterech polityk.
  it.fails("DEFEKT: autorzy tickera MUSZA isc przez widok profiles_public", async () => {
    db().setResponse("posts", () => ok([{ id: "p-1", slug: "a", author_id: "u-1" }]));
    db().setResponse("profiles", () => ok([]));
    db().setResponse("profiles_public", () => ok([]));

    await run(newsTickerQueryOptions({}, "pl"));

    expect(db().lastChain("profiles")).toBeUndefined();
    expect(db().lastChain("profiles_public")).toBeDefined();
  });
});

describe("slider z postow: rozstrzyganie zrodla", () => {
  it("jawne source wygrywa nad zawartoscia pozycji", () => {
    expect(sliderUsesPostsSource({ source: "posts", items: [{ image: "a.jpg" }] })).toBe(true);
  });

  it("items nie bedace tablica, tablica pusta i same zaslepki znacza tryb z postow", () => {
    expect(sliderUsesPostsSource({ items: "smiec" } as unknown as WidgetContent)).toBe(true);
    expect(sliderUsesPostsSource({ items: [] })).toBe(true);
    // Legacy defaulty edytora: slajdy z samym tytulem, bez zdjecia i bez wpisu.
    expect(
      sliderUsesPostsSource({ items: [{ title: "Pierwszy slajd" }, { title: "Drugi slajd" }] }),
    ).toBe(true);
  });

  it("choc jedna pozycja ZWIAZANA (zdjecie albo wpis) przelacza na tryb reczny", () => {
    expect(sliderUsesPostsSource({ items: [{ image: "a.jpg" }] })).toBe(false);
    expect(sliderUsesPostsSource({ items: [{ postId: "p-1" }] })).toBe(false);
    // Puste napisy nie wiaza pozycji - to nadal zaslepka.
    expect(sliderUsesPostsSource({ items: [{ image: "", postId: "" }] })).toBe(true);
  });
});

describe("slider z postow: przeciecie kategorii i tagow", () => {
  it("sam filtr kategorii USTAWIA zbior dozwolonych id", async () => {
    db().setResponse("post_categories", () => ok([{ post_id: "p-1" }, { post_id: "p-2" }]));
    db().setResponse("posts", () => ok([]));

    await run(sliderPostsQueryOptions({ categorySlugs: "ue" }, "pl"));

    expect(db().lastChain("posts")?.argsOf("in")).toEqual(["id", ["p-1", "p-2"]]);
  });

  it("tag bez dopasowanego sluga ZERUJE zbior i konczy [] bez zapytania o posty", async () => {
    db().setResponse("tags", () => ok([]));

    await expect(run(sliderPostsQueryOptions({ tagSlugs: "klimat" }, "pl"))).resolves.toEqual([]);
    expect(db().lastChain("posts")).toBeUndefined();
  });

  it("sam trafiony filtr tagow USTAWIA zbior (bez kategorii nie ma czego przecinac)", async () => {
    db().setResponse("tags", () => ok([{ id: "t-1" }]));
    db().setResponse("post_tags", () => ok([{ post_id: "p-3" }]));
    db().setResponse("posts", () => ok([]));

    await run(sliderPostsQueryOptions({ tagSlugs: "klimat" }, "pl"));

    expect(db().lastChain("posts")?.argsOf("in")).toEqual(["id", ["p-3"]]);
  });

  it("brak wierszy (data null) w kazdym ogniwie filtra konczy sie pustym zbiorem", async () => {
    db().setResponse("post_categories", () => ok(null));
    db().setResponse("posts", () => ok([]));
    await run(sliderPostsQueryOptions({ categorySlugs: "ue" }, "pl"));
    // Pusty zbior dozwolonych id konczy zapytanie PRZED pytaniem o posty.
    expect(db().lastChain("posts")).toBeUndefined();

    db().setResponse("tags", () => ok(null));
    await expect(run(sliderPostsQueryOptions({ tagSlugs: "klimat" }, "pl"))).resolves.toEqual([]);

    db().setResponse("tags", () => ok([{ id: "t-1" }]));
    db().setResponse("post_tags", () => ok(null));
    await expect(run(sliderPostsQueryOptions({ tagSlugs: "klimat" }, "pl"))).resolves.toEqual([]);
  });

  it("rozlaczne zbiory kategorii i tagow daja PRZECIECIE puste, a nie sume", async () => {
    db().setResponse("post_categories", () => ok([{ post_id: "p-1" }]));
    db().setResponse("tags", () => ok([{ id: "t-1" }]));
    db().setResponse("post_tags", () => ok([{ post_id: "p-9" }]));

    await expect(
      run(sliderPostsQueryOptions({ categorySlugs: "ue", tagSlugs: "klimat" }, "pl")),
    ).resolves.toEqual([]);
    expect(db().lastChain("posts")).toBeUndefined();
  });

  it("czesc wspolna kategorii i tagow trafia do ogniwa .in", async () => {
    db().setResponse("post_categories", () => ok([{ post_id: "p-1" }, { post_id: "p-2" }]));
    db().setResponse("tags", () => ok([{ id: "t-1" }]));
    db().setResponse("post_tags", () => ok([{ post_id: "p-2" }, { post_id: "p-9" }]));
    db().setResponse("posts", () => ok([]));

    await run(sliderPostsQueryOptions({ categorySlugs: "ue", tagSlugs: "klimat" }, "pl"));

    expect(db().lastChain("posts")?.argsOf("in")).toEqual(["id", ["p-2"]]);
  });

  it("wykluczenia, kierunek i kolumna sortowania trafiaja do zapytania", async () => {
    db().setResponse("posts", () => ok([]));

    await run(sliderPostsQueryOptions({ excludeIds: "a, b" }, "pl"));
    expect(db().lastChain("posts")?.argsOf("not")).toEqual(["id", "in", "(a,b)"]);

    await run(sliderPostsQueryOptions({ orderBy: "oldest" }, "pl"));
    expect(ascendingOf(db().lastChain("posts"))).toBe(true);
    expect(db().lastChain("posts")?.argsOf("order")?.[0]).toBe("published_at");

    await run(sliderPostsQueryOptions({ orderBy: "title" }, "en"));
    expect(db().lastChain("posts")?.argsOf("order")?.[0]).toBe("title_en");

    await run(sliderPostsQueryOptions({ orderBy: "title" }, "pl"));
    expect(db().lastChain("posts")?.argsOf("order")?.[0]).toBe("title_pl");

    // Bez wykluczen ogniwo `.not` NIE powstaje.
    await run(sliderPostsQueryOptions({}, "pl"));
    expect(db().lastChain("posts")?.has("not")).toBe(false);
  });

  it("odmowa odczytu wpisow slidera udaje pusty slider - hero ma zniknac, nie wywrocic strony", async () => {
    db().setResponse("posts", () => fail("permission denied for table posts", "42501"));

    await expect(run<SliderPostRow[]>(sliderPostsQueryOptions({}, "pl"))).resolves.toEqual([]);
  });
});
