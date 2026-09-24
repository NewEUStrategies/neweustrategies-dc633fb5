// Tablica programu: HTML z serwera i pierwszy render klienta muszą być
// identyczne, choć serwer i uczestnik stoją w różnych strefach czasowych.
//
// PRZEDMIOT DOWODU. Podpowiedź „Twoje urządzenie jest w innej strefie” zależy
// od strefy PRZEGLĄDARKI. Liczona wprost w renderze dawała na serwerze (UTC)
// inne zdanie niż u uczestnika w Warszawie - React zgłaszał niezgodność
// hydratacji i przerysowywał drzewo, a dokument z cache'u brzegowego niósł
// podpowiedź prawdziwą tylko dla maszyny renderującej. Test stawia HTML
// `renderToString` w strefie serwera, hydratuje go w strefie klienta i żąda
// ZERA błędów odzyskiwalnych; drugi przypadek pilnuje, że podpowiedź nadal
// pojawia się po hydratacji, gdy strefa uczestnika naprawdę jest inna.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/i18nReal";

import type { AgendaSession } from "@/lib/events/agendaSurface";
import { eventFrontPl } from "@/lib/i18n-event-front";

const zone = vi.hoisted(() => ({ current: "UTC" }));
vi.mock("@/lib/events/timezone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/timezone")>()),
  browserTimeZone: () => zone.current,
}));

const { EventAgendaBoardView } =
  await import("@/components/events/public/organisms/EventAgendaBoardView");

const FOREIGN = eventFrontPl.eventFront.agenda.timezoneForeign;

function session(over: Partial<AgendaSession> = {}): AgendaSession {
  return {
    id: "s1",
    eventId: "e1",
    parentSessionId: null,
    titlePl: "Debata otwarcia",
    titleEn: "Opening debate",
    descriptionPl: "Opis debaty",
    descriptionEn: null,
    affiliationPl: "Rada Programowa",
    affiliationEn: null,
    startsAt: "2026-09-01T08:00:00Z",
    endsAt: "2026-09-01T09:30:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sortOrder: 1,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: false,
    capacity: null,
    registeredCount: 0,
    seatsLeft: null,
    track: null,
    room: null,
    sponsor: { id: "sp1", name: "Partner", logoUrl: null, role: "partner" },
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "open",
    speakers: [],
    ...over,
  };
}

async function serverThenClient(serverZone: string, clientZone: string) {
  const view = <EventAgendaBoardView sessions={[session()]} lang="pl" signedIn={false} />;
  zone.current = serverZone;
  const host = document.createElement("div");
  host.innerHTML = renderToString(view);
  document.body.append(host);
  const serverHtml = host.innerHTML;

  zone.current = clientZone;
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
  });
  return { host, root, errors, serverHtml };
}

describe("EventAgendaBoardView - SSR i hydratacja", () => {
  afterEach(() => {
    zone.current = "UTC";
    document.body.innerHTML = "";
  });

  it("serwer w UTC i uczestnik w strefie wydarzenia: zero niezgodności, zero podpowiedzi", async () => {
    const { host, root, errors, serverHtml } = await serverThenClient("UTC", "Europe/Warsaw");
    try {
      // Serwer nie zna strefy uczestnika, więc NIE twierdzi, że jest inna.
      expect(serverHtml).not.toContain(FOREIGN);
      expect(errors).toEqual([]);
      expect(host.textContent).not.toContain(FOREIGN);
      // Godziny liczą się w strefie WYDARZENIA na obu maszynach.
      expect(host.textContent).toContain("10:00");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("uczestnik w innej strefie dostaje podpowiedź dopiero po hydratacji", async () => {
    const { host, root, errors, serverHtml } = await serverThenClient("UTC", "Pacific/Auckland");
    try {
      expect(serverHtml).not.toContain(FOREIGN);
      expect(errors).toEqual([]);
      expect(host.textContent).toContain(FOREIGN);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
