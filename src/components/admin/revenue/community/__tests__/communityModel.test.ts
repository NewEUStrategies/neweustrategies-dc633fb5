// Model zakładki „Społeczność" - czyste funkcje nad DTO S4.
//
// CO TEN PLIK DOWODZI.
//   1. Udział bez mianownika to `null` („brak danych"), nie 0.
//   2. Lejek klubów: decyzje = przyjęte + odrzucone, udział przyjętych
//      wśród decyzji; bez decyzji - `null`.
//   3. Pula biletów: tylko wydarzenia z pulą, od największej.
//   4. Nazwa w języku panelu, a przy pustej wersji - ta, która istnieje.
//   5. Sekcja z adresu i zestaw kafli zależą od modułu klubów (wyłączony =
//      tylko Wydarzenia; nieznany = kluby zostają).
import { describe, expect, it } from "vitest";

import { COMMUNITY_CLUB_TILES, COMMUNITY_EVENT_TILES, communityTilesFor } from "../communityTiles";
import {
  clubFunnelOf,
  communitySectionOf,
  localizedName,
  poolEvents,
  shareOf,
  ticketMoney,
} from "../communityModel";
import type { RevenueClubsSummaryDto, RevenueEventSummaryRow } from "@/lib/revenue/community/dto";
import { HUB_METRIC_IDS } from "@/lib/analytics/semantic/metrics";
import { CLUBS_SUMMARY, EVENTS_SUMMARY } from "./communityFixtures";
import { clone } from "../../overview/__tests__/hubFixtures";

describe("communityModel", () => {
  it("shareOf: bez mianownika null, nie 0", () => {
    expect(shareOf(3, 4)).toBe(0.75);
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(0, 5)).toBe(0);
  });

  it("ticketMoney: null zostaje null (rola bez kwot), lista per waluta bez sumy", () => {
    expect(ticketMoney(null)).toBeNull();
    expect(ticketMoney([...EVENTS_SUMMARY.byCurrency])).toEqual([
      { currency: "PLN", amountMinor: 450_000 },
      { currency: "EUR", amountMinor: 20_000 },
    ]);
  });

  it("clubFunnelOf: decyzje z dwóch stanów, udział przyjętych wśród decyzji", () => {
    const summary = clone(CLUBS_SUMMARY) as RevenueClubsSummaryDto;
    expect(clubFunnelOf(summary)).toEqual({
      submitted: 8,
      decided: 4,
      accepted: 3,
      acceptance: 0.75,
    });
    summary.applications = { submitted: 2, accepted: 0, rejected: 0, pending: 2 };
    expect(clubFunnelOf(summary).acceptance).toBeNull();
  });

  it("poolEvents: tylko wydarzenia z pulą, malejąco", () => {
    const rows = clone(EVENTS_SUMMARY.events) as RevenueEventSummaryRow[];
    rows.push({ ...rows[0], eventId: "x", planPool: 9 });
    expect(poolEvents(rows).map((row) => row.planPool)).toEqual([9, 6]);
  });

  it("localizedName: język panelu, a pusta wersja - ta, która istnieje", () => {
    expect(localizedName({ pl: "Klub", en: "Club" }, "en")).toBe("Club");
    expect(localizedName({ pl: "Klub", en: " " }, "en")).toBe("Klub");
    expect(localizedName({ pl: "", en: "Club" }, "pl")).toBe("Club");
  });
});

describe("sekcje i kafle zakładki", () => {
  it("sekcja z adresu: kluby tylko przy module, który nie jest wyłączony", () => {
    expect(communitySectionOf(undefined, true)).toBe("events");
    expect(communitySectionOf("clubs", true)).toBe("clubs");
    expect(communitySectionOf("clubs", null)).toBe("clubs");
    expect(communitySectionOf("clubs", false)).toBe("events");
    expect(communitySectionOf("discounts", true)).toBe("events");
  });

  it("kafle: wyłączone kluby = tylko wydarzenia; każdy kafel z rejestru huba", () => {
    expect(communityTilesFor(false)).toEqual(COMMUNITY_EVENT_TILES);
    expect(communityTilesFor(null)).toEqual([...COMMUNITY_EVENT_TILES, ...COMMUNITY_CLUB_TILES]);
    for (const spec of [...COMMUNITY_EVENT_TILES, ...COMMUNITY_CLUB_TILES]) {
      expect(HUB_METRIC_IDS).toContain(spec.metricId);
      expect(spec.drillHref).toBe("/admin/revenue/community");
    }
    // Kwota tylko dla administratora - redaktor dostaje kafel zablokowany.
    const money = [...COMMUNITY_EVENT_TILES, ...COMMUNITY_CLUB_TILES].filter((s) => s.money);
    expect(money.map((s) => [s.metricId, s.roles])).toEqual([["event_ticket_revenue", ["admin"]]]);
  });
});
