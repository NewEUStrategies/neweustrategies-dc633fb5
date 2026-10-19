// WYDARZENIE W KANWIE, KLUCZ PRELEGENTOW WYDARZENIA I LOGO INSTYTUCJI.
//
// Trzy kontrakty, ktorych dotad nie wywolal zaden test (pokrycie pokazywalo
// je jako martwe), a kazdy chroni przed cicha awaria:
//
// 1. `eventByIdForCanvasQueryOptions` - wydarzenie dla KANWY buildera czytane
//    BEZ filtra publikacji (redaktor podpina widget przed publikacja) i pod
//    OSOBNYM korzeniem klucza. Gdyby kanwa dzielila klucz z wersja publiczna,
//    szkic trafilby do cache'u strony i do danych zdehydratowanych z SSR;
//    gdyby dostala filtr `status = published`, karta w edytorze bylaby pusta
//    dokladnie wtedy, gdy ma pomagac. Odmowa bazy RZUCA (stan bledu), a nie
//    udaje "wydarzenia nie ma".
// 2. `eventSpeakersPublicKey` - jedna fabryka klucza dla mutacji panelu,
//    samoobslugi prelegenta i realtime. Dowodem jest PRAWDZIWY QueryClient:
//    inwalidacja trafia w kazdy limit TEGO wydarzenia, a omija inne
//    wydarzenia i katalog (`source: "directory"`).
// 3. `fetchLogos` - logo instytucji jest dekoracja karty: wyjatek przy jego
//    odczycie (zerwane polaczenie, a nie odmowa PostgREST) nie moze wyciac
//    listy prelegentow.
//
// GRANICE: klient Supabase jest atrapa z `@/test/supabase`; `edgeTtlCache`
// pod happy-dom przepuszcza fetcher bez cache'owania (ssrCache.ts), wiec
// kazde wywolanie realnie schodzi do atrapy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseFromStub, SupabaseRpcStub } from "@/test/supabase";

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
import {
  eventByIdForCanvasQueryOptions,
  eventByIdQueryOptions,
  type EventListRow,
} from "@/lib/builder/eventsQuery";
import {
  fetchLogos,
  speakersQueryOptions,
  type PublicSpeakerRow,
} from "@/lib/builder/speakersQuery";
import { eventSpeakersPublicKey, WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

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
  return (options.queryFn as () => Promise<T>)();
}

const SZKIC = { id: "ev-1", slug: "szkic", title_pl: "Szkic", status: "draft" };

beforeEach(() => {
  db().reset();
  rpc().reset();
});

describe("wydarzenie w kanwie buildera (bez filtra publikacji)", () => {
  it("czyta wiersz po id BEZ warunku status - szkic jest widoczny dla redaktora", async () => {
    db().setResponse("events", () => ok(SZKIC));

    const row = await run<EventListRow | null>(eventByIdForCanvasQueryOptions("ev-1"));

    expect(row?.title_pl).toBe("Szkic");
    const chain = db().lastChain("events");
    expect(chain?.argsOf("eq")).toEqual(["id", "ev-1"]);
    // Jedyny `eq` to id: filtr publikacji odcialby szkic w edytorze.
    expect(chain?.calls.filter((link) => link.method === "eq")).toHaveLength(1);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("ma OSOBNY korzen klucza niz wersja publiczna tego samego wydarzenia", () => {
    const kanwa = eventByIdForCanvasQueryOptions("ev-1").queryKey;
    const publiczny = eventByIdQueryOptions("ev-1").queryKey;

    expect(kanwa).toEqual([WIDGET_QUERY_ROOTS.eventByIdCanvas, "ev-1"]);
    expect(kanwa[0]).not.toBe(publiczny[0]);
  });

  it("pusty identyfikator daje null BEZ zapytania do bazy", async () => {
    await expect(run(eventByIdForCanvasQueryOptions(""))).resolves.toBeNull();
    expect(db().chainsFor("events")).toHaveLength(0);
  });

  it("brak wiersza (RLS gościa albo skasowane wydarzenie) daje null", async () => {
    db().setResponse("events", () => ok(null));

    await expect(run(eventByIdForCanvasQueryOptions("ev-1"))).resolves.toBeNull();
  });

  it("odmowa bazy RZUCA, zamiast udawac brak wydarzenia", async () => {
    db().setResponse("events", () => fail("permission denied for table events", "42501"));

    await expect(run(eventByIdForCanvasQueryOptions("ev-1"))).rejects.toMatchObject({
      message: "permission denied for table events",
    });
  });
});

describe("eventSpeakersPublicKey - zasieg inwalidacji na prawdziwym QueryClient", () => {
  it("unieważnia KAZDY limit tego wydarzenia, a omija inne wydarzenie i katalog", async () => {
    const qc = new QueryClient();
    const klucze = {
      ev1Male: speakersQueryOptions({ source: "event", eventId: "ev-1", limit: 4 }, "pl").queryKey,
      ev1Duze: speakersQueryOptions({ source: "event", eventId: "ev-1", limit: 24 }, "en").queryKey,
      ev2: speakersQueryOptions({ source: "event", eventId: "ev-2", limit: 4 }, "pl").queryKey,
      katalog: speakersQueryOptions({ source: "directory", limit: 4 }, "pl").queryKey,
    };
    for (const key of Object.values(klucze)) qc.setQueryData(key, [] as PublicSpeakerRow[]);

    await qc.invalidateQueries({ queryKey: eventSpeakersPublicKey("ev-1") });

    const uniewaznione = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(uniewaznione(klucze.ev1Male)).toBe(true);
    expect(uniewaznione(klucze.ev1Duze)).toBe(true);
    expect(uniewaznione(klucze.ev2)).toBe(false);
    expect(uniewaznione(klucze.katalog)).toBe(false);
  });
});

describe("logo instytucji prelegenta - dekoracja, ktora nie wycina listy", () => {
  it("odrzucona obietnica odczytu logo daje pusta mape", async () => {
    await expect(fetchLogos(() => Promise.reject(new Error("socket hang up")))).resolves.toEqual(
      new Map(),
    );
  });

  it("wyjatek rzucony synchronicznie przez wywolanie tez daje pusta mape", async () => {
    const logos = await fetchLogos(() => {
      throw new Error("klient niezainicjowany");
    });

    expect(logos.size).toBe(0);
  });

  it("zerwany odczyt logo w liscie wydarzenia zostawia prelegentow bez logo", async () => {
    rpc().setData("event_speakers_public", [
      { speaker_profile_id: "sp-1", user_id: "u-1", display_name: "Prelegentka Testowa" },
    ]);
    rpc().setResponse("event_speaker_logos_public", () => {
      throw new Error("socket hang up");
    });

    const rows = await run<PublicSpeakerRow[]>(
      speakersQueryOptions({ source: "event", eventId: "ev-1", limit: 4 }, "pl"),
    );

    expect(rows.map((r) => [r.display_name, r.card_institution_logo_url])).toEqual([
      ["Prelegentka Testowa", null],
    ]);
    expect(rpc().lastCall("event_speaker_logos_public")?.arg("p_event_id")).toBe("ev-1");
  });
});
