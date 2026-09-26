// Treść maili naboru: język zgłoszenia, wiersze szczegółów i cel przycisku.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// Najważniejsze: informacja zwrotna idzie WYŁĄCZNIE z `feedback_to_speaker`
// (nie z notatki wewnętrznej), odmowa prowadzi na stronę wydarzenia, prośba
// o zmiany - do formularza tego zgłoszenia.
import { describe, expect, it } from "vitest";

import { buildCfpNotice, cfpNoticeType, CFP_MAIL_NOTICES } from "@/lib/events/cfpNotify.server";

const ROW = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "t1",
  lang: "pl",
  first_name: "Anna",
  title_pl: "Energia jutra",
  title_en: "Energy of tomorrow",
  feedback_to_speaker: "Prosimy o skrócenie.",
  decision_note: "NOTATKA WEWNĘTRZNA",
  event_slug: "kongres",
  event_title_pl: "Kongres",
  event_title_en: "Congress",
  event_starts_at: "2026-10-01T08:00:00+00:00",
  event_timezone: "Europe/Warsaw",
  session_starts_at: "2026-10-01T12:30:00+00:00",
};

describe("cfpNoticeType", () => {
  it("każdy moment ma własny szablon", () => {
    const types = CFP_MAIL_NOTICES.map(cfpNoticeType);
    expect(types).toEqual([
      "event_cfp_submission_received",
      "event_cfp_submission_accepted",
      "event_cfp_submission_rejected",
      "event_cfp_submission_changes_requested",
    ]);
  });
});

describe("buildCfpNotice", () => {
  it("potwierdzenie: wydarzenie, wystąpienie, termin wydarzenia; bez informacji zwrotnej; do panelu", () => {
    const notice = buildCfpNotice("received", ROW);
    expect(notice).toMatchObject({
      type: "event_cfp_submission_received",
      lang: "pl",
      eventTitle: "Kongres",
      firstName: "Anna",
      tenantId: "t1",
      ctaPath: "/events/kongres/speaker",
    });
    expect(notice.details.map((detail) => detail.label)).toEqual(["Wydarzenie", "Wystąpienie", "Termin"]);
    expect(notice.details[1]?.value).toBe("Energia jutra");
    expect(notice.details[2]?.value).toContain("10:00");
    expect(JSON.stringify(notice)).not.toContain("NOTATKA");
  });

  it("przyjęcie: godzina SESJI i informacja zwrotna, po angielsku dla zgłoszenia po angielsku", () => {
    const notice = buildCfpNotice("accepted", { ...ROW, lang: "en" });
    expect(notice.lang).toBe("en");
    expect(notice.eventTitle).toBe("Congress");
    expect(notice.details.map((detail) => detail.label)).toEqual([
      "Event",
      "Talk",
      "Date",
      "Message from the organiser",
    ]);
    expect(notice.details[1]?.value).toBe("Energy of tomorrow");
    expect(notice.details[2]?.value).toContain("14:30");
    expect(notice.ctaPath).toBe("/events/kongres/speaker");
  });

  it("przyjęcie bez sesji: termin wydarzenia", () => {
    const notice = buildCfpNotice("accepted", { ...ROW, session_starts_at: null });
    expect(notice.details[2]?.value).toContain("10:00");
  });

  it("odmowa: bez terminu, z informacją zwrotną, przycisk na stronę wydarzenia", () => {
    const notice = buildCfpNotice("rejected", ROW);
    expect(notice.details.map((detail) => detail.label)).toEqual([
      "Wydarzenie",
      "Wystąpienie",
      "Wiadomość od organizatora",
    ]);
    expect(notice.ctaPath).toBe("/events/kongres");
  });

  it("prośba o zmiany: przycisk do formularza tego zgłoszenia", () => {
    expect(buildCfpNotice("changes_requested", ROW).ctaPath).toBe(
      "/events/kongres/cfp-submit?id=11111111-1111-4111-8111-111111111111",
    );
  });

  it("brakujące dane degradują bez wyjątku", () => {
    const notice = buildCfpNotice("changes_requested", {
      lang: "en",
      title_pl: "Tylko PL",
      feedback_to_speaker: "   ",
    });
    expect(notice).toMatchObject({ eventTitle: "", firstName: null, tenantId: null, ctaPath: "/events" });
    expect(notice.details).toEqual([{ label: "Talk", value: "Tylko PL" }]);
    expect(buildCfpNotice("rejected", {}).ctaPath).toBe("/events");
    expect(buildCfpNotice("received", { event_starts_at: "nie-data" }).details).toEqual([]);
    expect(buildCfpNotice("changes_requested", { event_slug: "k" }).ctaPath).toBe("/events/k/speaker");
  });
});
