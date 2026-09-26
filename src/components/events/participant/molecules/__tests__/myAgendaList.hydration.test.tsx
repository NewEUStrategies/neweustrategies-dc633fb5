// MÓJ HARMONOGRAM - HTML serwera i pierwszy render klienta muszą być
// identyczne, choć serwer i uczestnik stoją w różnych strefach czasowych.
//
// PRZEDMIOT DOWODU (EB-912, R-UI/SSR). Dawna lista formatowała godzinę przez
// `Intl.DateTimeFormat` BEZ strefy, czyli w strefie MASZYNY: serwer w UTC
// pisał 08:30, przeglądarka w Warszawie 10:30 - React zgłaszał niezgodność
// hydratacji, a uczestnik z innej strefy dostawał godzinę, o której sesja się
// nie zaczyna. Po zmianie godzina liczy się w strefie WYDARZENIA
// (`formatEventDateTime`), więc strefa maszyny nie ma na nią wpływu.
//
// JAK MIERZYMY. `process.env.TZ` przestawiamy między renderem serwera
// (`UTC`) a hydratacją (`Pacific/Auckland`) - Node czyta tę zmienną przy
// każdym formatowaniu. Kanarek na początku sprawdza, że przestawienie strefy
// naprawdę zmienia wynik formatowania BEZ strefy; bez niego test mógłby
// przechodzić tylko dlatego, że przestawienie nie działa.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/i18nReal";

import type { MyAgendaSession } from "@/lib/events/myEventProfileApi";
import { MyAgendaList } from "@/components/events/participant/molecules/MyAgendaList";
import { eventParticipantPl } from "@/lib/i18n-event-participant";

const ORIGINAL_TZ = process.env.TZ;

function sesja(over: Partial<MyAgendaSession> = {}): MyAgendaSession {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    titlePl: "Panel: energetyka jądrowa",
    titleEn: "Panel: nuclear energy",
    startsAt: "2026-09-15T08:30:00.000Z",
    endsAt: "2026-09-15T09:30:00.000Z",
    format: "panel",
    roomName: "Sala Bałtycka",
    roomFloor: "2",
    roomNamePl: "Sala Bałtycka",
    roomNameEn: "Sala Bałtycka",
    trackNamePl: null,
    trackNameEn: null,
    signupStatus: "waitlist",
    sessionStatus: "cancelled",
    timezone: "Europe/Warsaw",
    ...over,
  };
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  document.body.innerHTML = "";
});

describe("MyAgendaList - SSR i hydratacja w różnych strefach maszyn", () => {
  it("kanarek: przestawienie TZ zmienia formatowanie BEZ strefy", () => {
    const chwila = new Date("2026-09-15T08:30:00.000Z");
    process.env.TZ = "UTC";
    const utc = chwila.toLocaleTimeString("pl-PL");
    process.env.TZ = "Pacific/Auckland";
    const auckland = chwila.toLocaleTimeString("pl-PL");
    expect(utc).not.toBe(auckland);
  });

  it("serwer w UTC i uczestnik w Auckland: zero niezgodności, godzina w strefie wydarzenia", async () => {
    const view = <MyAgendaList sessions={[sesja()]} loading={false} />;
    process.env.TZ = "UTC";
    const host = document.createElement("div");
    host.innerHTML = renderToString(view);
    document.body.append(host);
    const serverHtml = host.innerHTML;

    process.env.TZ = "Pacific/Auckland";
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    try {
      expect(errors).toEqual([]);
      expect(serverHtml).toContain("10:30");
      expect(host.textContent).toContain("10:30");
      // Plakietki stanu jadą w HTML-u serwera - to nie są dane zależne od klienta.
      expect(serverHtml).toContain(eventParticipantPl.eventParticipant.agenda.cancelled);
      expect(serverHtml).toContain(eventParticipantPl.eventParticipant.agenda.waitlist);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
