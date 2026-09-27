// Liście wydzielone po to, żeby chunk wejściowy nie niósł reguł, których
// czytelnik nie potrzebuje: `eventCloneSearch` (z `eventCloneDraft`),
// `speakerTracks` (z `speakerCard`), `eventListSearch` (z `eventListParams`),
// `eventFormats` (z `eventTypes`) i `clubEditorTabs` (z `adminClubEditor`).
// Zachowanie pilnują testy modułów źródłowych, które idą przez re-eksporty.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
// (1) re-eksport zostaje zastąpiony KOPIĄ funkcji - trasa i ekran klonu (albo
//     prefetch buildera i karta prelegenta) zaczynają sprawdzać dane dwiema
//     regułami, które rozjadą się przy pierwszej zmianie jednej z nich;
// (2) moduł z chunku wejściowego dostaje import runtime'owy i po cichu
//     wciąga coś z powrotem do bootu każdej strony.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as clubEditor from "@/lib/clubs/adminClubEditor";
import { CLUB_EDITOR_TABS, clubEditorTab } from "@/lib/clubs/clubEditorTabs";
import * as cloneDraft from "@/lib/events/eventCloneDraft";
import { EVENT_FORMATS, isEventFormat } from "@/lib/events/eventFormats";
import * as listParams from "@/lib/events/eventListParams";
import {
  EVENT_LIST_PAGE_SIZE,
  EVENT_LIST_PAGE_SIZES,
  EVENT_LIST_TABS,
  parseEventListParams,
} from "@/lib/events/eventListSearch";
import * as eventTypes from "@/lib/events/eventTypes";
import { parseCloneSearch } from "@/lib/events/eventCloneSearch";
import * as speakerCard from "@/lib/events/speakerCard";
import { hexColorOrNull, parseSpeakerTracks, textOrNull } from "@/lib/events/speakerTracks";

describe("moduły lekkie dla chunku wejściowego", () => {
  it("`eventCloneDraft` re-eksportuje TĘ SAMĄ funkcję `?from=`", () => {
    expect(cloneDraft.parseCloneSearch).toBe(parseCloneSearch);
  });

  it("`speakerCard` re-eksportuje TEN SAM parser ścieżek i kolor", () => {
    expect(speakerCard.parseSpeakerTracks).toBe(parseSpeakerTracks);
    expect(speakerCard.hexColorOrNull).toBe(hexColorOrNull);
  });

  it("`eventListParams` i `eventTypes` re-eksportują TE SAME symbole z liści", () => {
    expect(listParams.parseEventListParams).toBe(parseEventListParams);
    expect(listParams.EVENT_LIST_TABS).toBe(EVENT_LIST_TABS);
    expect(listParams.EVENT_LIST_PAGE_SIZES).toBe(EVENT_LIST_PAGE_SIZES);
    expect(listParams.EVENT_LIST_PAGE_SIZE).toBe(EVENT_LIST_PAGE_SIZE);
    expect(eventTypes.isEventFormat).toBe(isEventFormat);
    expect(eventTypes.EVENT_FORMATS).toBe(EVENT_FORMATS);
  });

  it("`adminClubEditor` re-eksportuje TE SAME zakładki i odczyt `?tab=`", () => {
    expect(clubEditor.clubEditorTab).toBe(clubEditorTab);
    expect(clubEditor.CLUB_EDITOR_TABS).toBe(CLUB_EDITOR_TABS);
  });

  it("`textOrNull` obcina brzegi i oddaje `null` dla pustych i nie-napisów", () => {
    expect(textOrNull("  Ścieżka A ")).toBe("Ścieżka A");
    expect(textOrNull("   ")).toBeNull();
    expect(textOrNull(7)).toBeNull();
  });

  it.each([
    "src/lib/events/eventCloneSearch.ts",
    "src/lib/events/speakerTracks.ts",
    "src/lib/events/eventFormats.ts",
    "src/lib/clubs/clubEditorTabs.ts",
  ])("%s nie ma ani jednego importu runtime'owego", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/^import\s+(?!type\s)/m);
  });
});

describe("`eventListSearch` - importuje wyłącznie liść formatu", () => {
  it("jedyny import runtime'owy to `eventFormats`", () => {
    const source = readFileSync("src/lib/events/eventListSearch.ts", "utf8");
    const runtime = [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)";/gms)].map(
      (match) => match[1],
    );
    expect(runtime).toEqual(["@/lib/events/eventFormats"]);
  });
});
