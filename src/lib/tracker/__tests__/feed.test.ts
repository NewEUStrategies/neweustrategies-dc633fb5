import { describe, expect, it } from "vitest";
import {
  buildTrackerFeedItems,
  trackerFeedChannelText,
  TRACKER_FEED_PATH,
  type TrackerFeedItemSource,
  type TrackerFeedUpdateSource,
} from "@/lib/tracker/feed";

const item = (over: Partial<TrackerFeedItemSource> = {}): TrackerFeedItemSource => ({
  id: "item-1",
  slug: "ai-act",
  title_pl: "Akt o sztucznej inteligencji",
  title_en: "AI Act",
  summary_pl: "Streszczenie PL",
  summary_en: "Summary EN",
  policy_area: "digital",
  stage: "trilogue",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-02T10:00:00.000Z",
  ...over,
});

const update = (over: Partial<TrackerFeedUpdateSource> = {}): TrackerFeedUpdateSource => ({
  id: "upd-1",
  item_id: "item-1",
  note_pl: "Rada przyjęła stanowisko",
  note_en: "Council adopted its position",
  stage_from: "parliament",
  stage_to: "council",
  happened_on: "2026-08-02",
  created_at: "2026-08-02T12:00:00.000Z",
  ...over,
});

const base = { origin: "https://nes.test", lang: "pl" as const, limit: 50 };

describe("buildTrackerFeedItems - scalanie strumieni", () => {
  it("scala dossier i aktualizacje w jeden porządek malejąco po dacie", () => {
    const items = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [update()],
    });
    expect(items).toHaveLength(2);
    // Aktualizacja (12:00 dnia 02.08) jest świeższa niż dossier (10:00 dnia 01.08).
    expect(items[0]?.guid).toBe("tracker:update:upd-1");
    expect(items[1]?.guid).toBe("tracker:item:item-1");
  });

  it("ODRZUCA aktualizację bez dossier na liście (sierota)", () => {
    // Defense in depth: wpis dossier nieopublikowanego albo z innego tenanta
    // nie ma prawa wyciec do publicznego kanału, nawet gdyby czytnik go zwrócił.
    const items = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [update({ id: "upd-orphan", item_id: "item-obcy" })],
    });
    expect(items.map((i) => i.guid)).toEqual(["tracker:item:item-1"]);
    expect(JSON.stringify(items)).not.toContain("upd-orphan");
  });

  it("nadaje rozłączne, stabilne GUID-y wielu aktualizacjom tego samego dossier", () => {
    const items = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [
        update({ id: "upd-1", created_at: "2026-08-02T12:00:00.000Z" }),
        update({ id: "upd-2", created_at: "2026-08-03T12:00:00.000Z" }),
      ],
    });
    const guids = items.map((i) => i.guid);
    expect(new Set(guids).size).toBe(guids.length);
    // Wszystkie trzy pozycje wskazują to samo dossier - stąd potrzeba guidów.
    expect(items.filter((i) => i.url.includes("/tracker/ai-act"))).toHaveLength(3);
  });

  it("linkuje aktualizację do kotwicy wpisu osi czasu", () => {
    const [first] = buildTrackerFeedItems({ ...base, items: [item()], updates: [update()] });
    expect(first?.url).toBe("https://nes.test/tracker/ai-act#update-upd-1");
  });

  it("porządek jest deterministyczny przy identycznych datach (tiebreaker po guid)", () => {
    const sameTime = "2026-08-02T12:00:00.000Z";
    const forward = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [
        update({ id: "upd-b", created_at: sameTime }),
        update({ id: "upd-a", created_at: sameTime }),
      ],
    });
    const reversed = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [
        update({ id: "upd-a", created_at: sameTime }),
        update({ id: "upd-b", created_at: sameTime }),
      ],
    });
    expect(forward.map((i) => i.guid)).toEqual(reversed.map((i) => i.guid));
    expect(forward[0]?.guid).toBe("tracker:update:upd-a");
  });

  it("obcina wynik do limitu PO scaleniu, nie przed", () => {
    const items = buildTrackerFeedItems({
      ...base,
      limit: 2,
      items: [item(), item({ id: "item-2", slug: "csam", created_at: "2026-07-01T10:00:00.000Z" })],
      updates: [update({ id: "upd-new", created_at: "2026-08-05T10:00:00.000Z" })],
    });
    expect(items).toHaveLength(2);
    expect(items[0]?.guid).toBe("tracker:update:upd-new");
  });

  it("limit <= 0 daje pusty kanał", () => {
    expect(
      buildTrackerFeedItems({ ...base, limit: 0, items: [item()], updates: [update()] }),
    ).toEqual([]);
  });
});

describe("buildTrackerFeedItems - lokalizacja PL/EN", () => {
  it("używa tytułów, streszczeń i not aktywnego języka", () => {
    const [updateEntry, dossierEntry] = buildTrackerFeedItems({
      ...base,
      lang: "en",
      items: [item()],
      updates: [update()],
    });
    expect(updateEntry?.title).toBe("AI Act - stage: Parliament -> Council");
    expect(updateEntry?.description).toBe("Council adopted its position");
    expect(dossierEntry?.title).toBe("AI Act (new file)");
    expect(dossierEntry?.description).toBe("Summary EN");
    expect(dossierEntry?.url).toBe("https://nes.test/en/tracker/ai-act");
  });

  it("podstawia drugi język, gdy tłumaczenie brakuje (kanał nie może być pusty)", () => {
    // Inaczej niż sekcja takeaways: feed jest jednym kanałem na język, więc
    // pusty tytuł byłby pozycją-widmem w czytniku.
    const [, dossierEntry] = buildTrackerFeedItems({
      ...base,
      lang: "en",
      items: [item({ title_en: "   ", summary_en: null })],
      updates: [update({ note_en: "  " })],
    });
    expect(dossierEntry?.title).toBe("Akt o sztucznej inteligencji (new file)");
    expect(dossierEntry?.description).toBe("Streszczenie PL");
  });

  it("spada na slug, gdy oba tytuły są puste", () => {
    const [only] = buildTrackerFeedItems({
      ...base,
      items: [item({ title_pl: " ", title_en: " " })],
      updates: [],
    });
    expect(only?.title).toBe("ai-act (nowe dossier)");
  });

  it("kwalifikator tytułu odzwierciedla rodzaj zmiany", () => {
    const [withFrom] = buildTrackerFeedItems({ ...base, items: [item()], updates: [update()] });
    expect(withFrom?.title).toContain("etap: Parlament -> Rada");

    const [onlyTo] = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [update({ stage_from: null, stage_to: "adopted" })],
    });
    expect(onlyTo?.title).toContain("etap: Przyjęte");

    const [noStage] = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [update({ stage_from: null, stage_to: null })],
    });
    expect(noStage?.title).toContain("aktualizacja");
  });

  it("kwalifikator „tylko nowy etap” ma też wersję ANGIELSKĄ", () => {
    // Tablica napisów kanału jest zduplikowana per język, a testy dotykały
    // angielskiej gałęzi tylko dla zmiany „z -> do". Wpis z samym `stage_to`
    // (pierwszy etap dossier) leciał w EN bez pokrycia, więc literówka albo
    // brakujący klucz byłyby widoczne dopiero w czytniku RSS użytkownika.
    const [onlyToEn] = buildTrackerFeedItems({
      ...base,
      lang: "en",
      items: [item()],
      updates: [update({ stage_from: null, stage_to: "adopted" })],
    });
    expect(onlyToEn?.title).toContain("stage: Adopted");
  });

  it("kategorie niosą obszar polityki i etap w aktywnym języku", () => {
    const [updateEntry] = buildTrackerFeedItems({ ...base, items: [item()], updates: [update()] });
    expect(updateEntry?.categories).toEqual(["Cyfryzacja", "Rada"]);

    const [updateEn] = buildTrackerFeedItems({
      ...base,
      lang: "en",
      items: [item()],
      updates: [update()],
    });
    expect(updateEn?.categories).toEqual(["Digital", "Council"]);
  });

  it("spada na happened_on, gdy created_at jest niepoprawny", () => {
    const [entry] = buildTrackerFeedItems({
      ...base,
      items: [item()],
      updates: [update({ created_at: "nie-data", happened_on: "2026-08-09" })],
    });
    expect(entry?.publishedAt).toBe("2026-08-09");
  });
});

describe("buildTrackerFeedItems - porządek przy brakującej dacie", () => {
  it("dossier bez użytecznej daty zostaje w kanale i NIE ląduje na górze", () => {
    // Kolumna jest w typach nie-nullowalna, ale w kanale publicznym wolimy
    // pozycję bez daty niż brak pozycji: czytelnik i tak dostaje tytuł oraz
    // odnośnik. Kluczowe jest to, że taki wpis nie wypycha świeżych zmian.
    const entries = buildTrackerFeedItems({
      ...base,
      items: [
        item({ id: "bez-daty", slug: "bez-daty", created_at: "" }),
        item({ id: "swieze", slug: "swieze", created_at: "2026-08-10T10:00:00.000Z" }),
      ],
      updates: [],
    });
    expect(entries.map((e) => e.guid)).toEqual(["tracker:item:swieze", "tracker:item:bez-daty"]);
  });
});

describe("metadane kanału", () => {
  it("ma tytuł i opis w obu językach", () => {
    expect(trackerFeedChannelText("pl").title).toBe("Tracker legislacyjny UE");
    expect(trackerFeedChannelText("en").title).toBe("EU legislative tracker");
    expect(trackerFeedChannelText("pl").description.length).toBeGreaterThan(20);
    expect(trackerFeedChannelText("en").description.length).toBeGreaterThan(20);
  });

  it("ścieżka kanału jest stałą współdzieloną z trasą i autodiscovery", () => {
    expect(TRACKER_FEED_PATH).toBe("/tracker/rss.xml");
  });
});
