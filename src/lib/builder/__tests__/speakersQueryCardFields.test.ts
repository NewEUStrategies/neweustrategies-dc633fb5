// POLA KARTY ROZWIJANEJ i SCIEZKI w wierszu prelegenta (`mapSpeakerRow`)
// oraz klucz cache projekcji wydarzenia.
//
// CO TU JEST DO OBRONY
//
// 1. PUSTKA UDAJACA WARTOSC. Pola karty przychodza z `jsonb`/kolumn
//    nullowalnych - NULL, pusty napis, liczba z blednej migracji. Karta
//    rozroznia `null` (ustawienia domyslne) od napisu (narysuj), wiec kazde
//    „nic" musi zejsc do `null`, a nie do "" albo liczby.
//
// 2. SCIEZKI SA WYPROWADZANE, NIE WPISYWANE. Baza oddaje `tracks` jako
//    tablice obiektow w snake_case; wiersz dostaje je w ksztalcie
//    `SpeakerTrack`. Stary wpis cache sprzed kolumny (`tracks` brak albo
//    obiekt zamiast tablicy) ma dac pusta liste, a nie wyjatek przy renderze.
//
// 3. KLUCZ CACHE MA WERSJE. Od 20260924140000 projekcja wydarzenia oddaje pola
//    karty i sciezki; wpis rozgrzany przed zmiana (`builder:event-speakers:`
//    bez `v2`) dawalby karte bez nich przez caly TTL. Klucz widac przez atrape
//    `edgeTtlCache`, ktora zapisuje klucz i przepuszcza fetcher.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  cacheCalls: [] as { key: string; ttlMs: number }[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub } = await import("@/test/supabase");
  const rpcStub = supabaseRpcStub();
  sb.rpc = rpcStub;
  return { supabase: { rpc: rpcStub.rpc } };
});

vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T>(key: string, ttlMs: number, fn: () => Promise<T>) => {
    sb.cacheCalls.push({ key, ttlMs });
    return fn();
  },
  invalidateEdgeTtlCache: async () => {},
  clearEdgeTtlCache: () => {},
}));

import {
  mapSpeakerRow,
  speakersQueryOptions,
  type PublicSpeakerRow,
} from "@/lib/builder/speakersQuery";

const rpc = (): SupabaseRpcStub => {
  if (!sb.rpc) throw new Error("atrapa `rpc` nie zostala zamontowana");
  return sb.rpc;
};

async function run<T>(options: { queryFn?: unknown }): Promise<T> {
  const fn = options.queryFn as () => Promise<T>;
  return fn();
}

beforeEach(() => {
  rpc().reset();
  sb.cacheCalls.length = 0;
});

/* -------------------------------------------------------------- pola karty -- */

describe("mapSpeakerRow - pola karty rozwijanej", () => {
  it("niepuste pola karty jada do wiersza bez zmian", () => {
    const row = mapSpeakerRow({
      user_id: "u-1",
      card_photo_url: "https://cdn.test/full.jpg",
      card_cta_label_pl: "Zobacz wystapienie",
      card_cta_label_en: "Watch the talk",
      card_cta_url: "/wydarzenia/forum",
      card_cta_color: "#FA9346",
    });
    expect(row).toMatchObject({
      card_photo_url: "https://cdn.test/full.jpg",
      card_cta_label_pl: "Zobacz wystapienie",
      card_cta_label_en: "Watch the talk",
      card_cta_url: "/wydarzenia/forum",
      card_cta_color: "#FA9346",
    });
  });

  it("wiersz BEZ pol karty (katalog, stary wpis cache) ma je NULL-em, a nie undefined", () => {
    const row = mapSpeakerRow({ user_id: "u-1" });
    expect(row.card_photo_url).toBeNull();
    expect(row.card_cta_label_pl).toBeNull();
    expect(row.card_cta_label_en).toBeNull();
    expect(row.card_cta_url).toBeNull();
    expect(row.card_cta_color).toBeNull();
  });

  it("NULL, pusty napis i wartosc nie-napisowa schodza do NULL", () => {
    for (const empty of [null, undefined, "", 0, 42, false, {}, []]) {
      const row = mapSpeakerRow({
        user_id: "u-1",
        card_photo_url: empty,
        card_cta_label_pl: empty,
        card_cta_label_en: empty,
        card_cta_url: empty,
        card_cta_color: empty,
      });
      expect(row).toMatchObject({
        card_photo_url: null,
        card_cta_label_pl: null,
        card_cta_label_en: null,
        card_cta_url: null,
        card_cta_color: null,
      });
    }
  });

  it("jedna etykieta ustawiona, druga pusta - kazdy jezyk rozstrzyga sie osobno", () => {
    const row = mapSpeakerRow({
      user_id: "u-1",
      card_cta_label_pl: "Bilety",
      card_cta_label_en: "",
    });
    expect(row.card_cta_label_pl).toBe("Bilety");
    expect(row.card_cta_label_en).toBeNull();
  });
});

/* ----------------------------------------------------------------- sciezki -- */

describe("mapSpeakerRow - sciezki prelegenta", () => {
  it("sciezki z bazy przechodza do ksztaltu karty (snake_case -> camelCase)", () => {
    const row = mapSpeakerRow({
      user_id: "u-1",
      tracks: [
        {
          id: "t-1",
          key: "policy",
          name_pl: "Polityka",
          name_en: "Policy",
          accent_color: "#FA9346",
          sessions_count: 2,
        },
      ],
    });
    expect(row.tracks).toEqual([
      {
        id: "t-1",
        key: "policy",
        namePl: "Polityka",
        nameEn: "Policy",
        accentColor: "#FA9346",
        sessionsCount: 2,
      },
    ]);
  });

  it("BRAK sciezek albo zly ksztalt jsonb daje pusta liste, a nie wyjatek", () => {
    for (const raw of [undefined, null, "", "t-1", 7, {}, { id: "t-1", name_pl: "X" }]) {
      expect(mapSpeakerRow({ user_id: "u-1", tracks: raw }).tracks).toEqual([]);
    }
    expect(mapSpeakerRow({ user_id: "u-1", tracks: [] }).tracks).toEqual([]);
  });

  it("wpisy, ktorych nie da sie narysowac, wypadaja - reszta zostaje w kolejnosci", () => {
    const row = mapSpeakerRow({
      user_id: "u-1",
      tracks: [
        null,
        "t-x",
        ["t-y"],
        { name_pl: "Bez identyfikatora" },
        { id: "   ", name_pl: "Identyfikator z samych spacji" },
        { id: "t-bez-nazwy", name_pl: "", name_en: "   " },
        { id: "t-2", name_en: "Energy" },
        { id: "t-1", name_pl: "Polityka" },
        // Duplikat identyfikatora: klucz Reacta musi byc jednoznaczny.
        { id: "t-2", name_pl: "Duplikat" },
      ],
    });
    expect(row.tracks?.map((t) => [t.id, t.namePl, t.nameEn])).toEqual([
      ["t-2", null, "Energy"],
      ["t-1", "Polityka", null],
    ]);
  });

  it("licznik sesji: liczba z napisu, ulamek w dol, a ujemny i brak to zero", () => {
    const counts = (value: unknown) =>
      mapSpeakerRow({
        user_id: "u-1",
        tracks: [{ id: "t-1", name_pl: "P", sessions_count: value }],
      }).tracks?.[0]?.sessionsCount;
    expect(counts(3)).toBe(3);
    expect(counts("4")).toBe(4);
    expect(counts(2.9)).toBe(2);
    expect(counts(-1)).toBe(0);
    expect(counts(undefined)).toBe(0);
    expect(counts("abc")).toBe(0);
  });

  it("kolor spoza ksztaltu #RRGGBB i puste pola opisowe schodza do NULL", () => {
    const [track] =
      mapSpeakerRow({
        user_id: "u-1",
        tracks: [{ id: "t-1", key: "  ", name_pl: "P", name_en: "", accent_color: "red" }],
      }).tracks ?? [];
    expect(track).toMatchObject({ key: null, nameEn: null, accentColor: null });
  });
});

/* --------------------------------------------- projekcja wydarzenia + cache -- */

describe("zrodlo `event` - klucz cache i pola karty z RPC", () => {
  it("projekcja wydarzenia siedzi pod kluczem `builder:event-speakers:v2:` z TTL minuty", async () => {
    rpc().setData("event_speakers_public", []);

    await run(speakersQueryOptions({ source: "event", eventId: "e-1", limit: 12 }, "pl"));

    expect(sb.cacheCalls).toEqual([{ key: "builder:event-speakers:v2:e-1:12", ttlMs: 60_000 }]);
  });

  it("klucz wydarzenia NIE jest kluczem sprzed zmiany ani kluczem katalogu", async () => {
    rpc().setData("event_speakers_public", []);
    rpc().setData("get_public_speakers", []);

    await run(speakersQueryOptions({ source: "event", eventId: "e-1" }, "pl"));
    await run(speakersQueryOptions({ source: "directory" }, "pl"));

    const [eventKey, directoryKey] = sb.cacheCalls.map((c) => c.key);
    expect(eventKey).not.toBe("builder:event-speakers:e-1:24");
    expect(eventKey?.startsWith("builder:event-speakers:v2:")).toBe(true);
    expect(directoryKey?.startsWith("builder:speakers:")).toBe(true);
    expect(directoryKey).not.toContain("event-speakers");
  });

  it("tryb wydarzenia bez wydarzenia nie dotyka cache ani bazy", async () => {
    await expect(run(speakersQueryOptions({ source: "event" }, "pl"))).resolves.toEqual([]);
    expect(sb.cacheCalls).toHaveLength(0);
    expect(rpc().calls).toHaveLength(0);
  });

  it("pola karty i sciezki z RPC wydarzenia docieraja do wiersza, takze bez konta", async () => {
    rpc().setData("event_speakers_public", [
      {
        user_id: "u-1",
        display_name: "Anna",
        card_photo_url: "https://cdn.test/anna-full.jpg",
        card_cta_url: "https://example.org/talk",
        card_cta_color: "#000000",
        tracks: [{ id: "t-1", name_pl: "Polityka", sessions_count: 1 }],
      },
      {
        person_id: "p-1",
        display_name: "Osoba bez konta",
        card_cta_label_pl: "Profil",
        tracks: null,
      },
    ]);

    const rows = await run<PublicSpeakerRow[]>(
      speakersQueryOptions({ source: "event", eventId: "e-1" }, "pl"),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      card_photo_url: "https://cdn.test/anna-full.jpg",
      card_cta_url: "https://example.org/talk",
      card_cta_color: "#000000",
      card_cta_label_pl: null,
    });
    expect(rows[0]?.tracks?.map((t) => t.id)).toEqual(["t-1"]);
    expect(rows[1]).toMatchObject({
      user_id: "",
      person_id: "p-1",
      card_cta_label_pl: "Profil",
      card_photo_url: null,
      tracks: [],
    });
  });
});
