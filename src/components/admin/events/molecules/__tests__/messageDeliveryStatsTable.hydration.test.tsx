// DZIENNIK DORĘCZEŃ - HTML serwera i pierwszy render klienta identyczne,
// choć maszyna serwera (UTC) i przeglądarka organizatora stoją w różnych
// strefach (R-UI/SSR, EB-912).
//
// „Ostatnia wysyłka" liczy się w strefie WYDARZENIA (`formatEventDateTime` +
// `eventTimeZoneLabel`), więc strefa maszyny nie zmienia ani godziny, ani
// skrótu strefy. `process.env.TZ` przestawiamy między renderem serwera
// a hydratacją; kanarek sprawdza, że przestawienie naprawdę działa.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/i18nReal";

import { MessageDeliveryStatsTable } from "@/components/admin/events/molecules/MessageDeliveryStatsTable";
import type { MessageDeliveryStats } from "@/lib/events/participantSettingsApi";

const ORIGINAL_TZ = process.env.TZ;

const STATS: MessageDeliveryStats = {
  rows: [
    { kind: "session_reminder", channel: "inapp", claimed: 0, sent: 12, skipped: 0, failed: 1 },
  ],
  lastSentAt: "2026-09-15T08:30:00.000Z",
};

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  document.body.innerHTML = "";
});

describe("MessageDeliveryStatsTable - SSR i hydratacja", () => {
  it("kanarek: przestawienie TZ zmienia formatowanie BEZ strefy", () => {
    const chwila = new Date(STATS.lastSentAt ?? "");
    process.env.TZ = "UTC";
    const utc = chwila.toLocaleTimeString("pl-PL");
    process.env.TZ = "America/Los_Angeles";
    expect(chwila.toLocaleTimeString("pl-PL")).not.toBe(utc);
  });

  it("serwer w UTC, organizator w Los Angeles: zero niezgodności, godzina w strefie wydarzenia", async () => {
    const view = <MessageDeliveryStatsTable stats={STATS} timezone="Europe/Warsaw" />;
    process.env.TZ = "UTC";
    const host = document.createElement("div");
    host.innerHTML = renderToString(view);
    document.body.append(host);
    const serverHtml = host.innerHTML;

    process.env.TZ = "America/Los_Angeles";
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    try {
      expect(errors).toEqual([]);
      expect(serverHtml).toContain("10:30");
      expect(host.textContent).toContain("10:30");
      // Etykiety z prawdziwego słownika, nie surowe klucze.
      expect(host.textContent).not.toContain("adminEventParticipant.");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
