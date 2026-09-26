// Maile funkcji uczestnika F1-F5 (spec B.8): render każdego typu w PL i EN,
// kontrakt wierszy szczegółów i kategoria listy wykluczeń.
//
// STAWKI. Treść tych maili jest STATYCZNA (S34) - zmienne dane jadą tylko
// w temacie i w wierszach szczegółów. Dlatego dowodzimy: (1) każdy typ
// renderuje się w obu językach z marką, preheaderem i przyciskiem;
// (2) wiersze szczegółów to DOKŁADNIE kontrakt `PARTICIPANT_TX_DETAIL_LABELS`
// (te same klucze w PL i EN, bez dwóch jednakowych etykiet w jednym mailu);
// (3) po renderze nie zostaje żaden `{`/`}` - ślad niewypełnionego slotu;
// (4) polska treść nie zdradza płci odbiorcy (brak form „-łeś/-łaś").
import { describe, expect, it } from "vitest";

import { TX_EMAIL_CATEGORY } from "@/lib/email/suppressionPolicy";
import {
  participantDemoData,
  renderTxEmailPreview,
  TX_EMAIL_TYPES as PREVIEW_TYPES,
} from "@/lib/email/tx-preview.server";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import {
  PARTICIPANT_TX_DETAIL_LABELS,
  PARTICIPANT_TX_EMAIL_TYPES,
  TX_EMAIL_TYPES,
  isParticipantTxEmailType,
  txCopy,
  txSubject,
} from "@/lib/email-templates/tx-copy";

const LANGS: readonly EmailLang[] = ["pl", "en"];

describe("rejestr maili uczestnika", () => {
  it("jedenaście typów, wszystkie w słowniku i w podglądzie", () => {
    expect(PARTICIPANT_TX_EMAIL_TYPES).toHaveLength(11);
    for (const type of PARTICIPANT_TX_EMAIL_TYPES) {
      expect(TX_EMAIL_TYPES).toContain(type);
      expect(PREVIEW_TYPES).toContain(type);
    }
    expect(Object.keys(PARTICIPANT_TX_DETAIL_LABELS).sort()).toEqual(
      [...PARTICIPANT_TX_EMAIL_TYPES].sort(),
    );
  });

  it("isParticipantTxEmailType odróżnia nowe typy od dotychczasowych", () => {
    expect(isParticipantTxEmailType("event_waitlist_offer")).toBe(true);
    expect(isParticipantTxEmailType("event_ticket_issued")).toBe(false);
    expect(isParticipantTxEmailType("subscription_confirmed")).toBe(false);
  });

  it("kategorie: zaproszenie do ankiety bulk, reszta transakcyjna", () => {
    for (const type of PARTICIPANT_TX_EMAIL_TYPES) {
      expect(TX_EMAIL_CATEGORY[type], type).toBe(
        type === "event_survey_invite" ? "bulk" : "transactional",
      );
    }
  });

  it("nowe etykiety szczegółów w PL i EN", () => {
    const pl = txCopy("event_reminder", "pl").labels;
    const en = txCopy("event_reminder", "en").labels;
    expect({ d: pl.deadline, s: pl.session, r: pl.room, rc: pl.recipient, sn: pl.sender }).toEqual({
      d: "Ostateczny termin",
      s: "Sesja",
      r: "Sala",
      rc: "Odbiorca",
      sn: "Nadawca",
    });
    expect({ d: en.deadline, s: en.session, r: en.room, rc: en.recipient, sn: en.sender }).toEqual({
      d: "Deadline",
      s: "Session",
      r: "Room",
      rc: "Recipient",
      sn: "From",
    });
    // Mail o przekazaniu niesie `date` i `deadline` naraz - napisy nie mogą się pokryć.
    expect(pl.deadline).not.toBe(pl.date);
    expect(en.deadline).not.toBe(en.date);
  });

  it("event_registered obiecuje przypomnienie WARUNKOWO (MIN-13)", () => {
    expect(txCopy("event_registered", "pl").note).toMatch(
      /^Jeśli organizator włączył przypomnienia, /,
    );
    expect(txCopy("event_registered", "en").note).toMatch(/^If the organiser enabled reminders, /);
  });
});

describe.each(PARTICIPANT_TX_EMAIL_TYPES)("%s", (type) => {
  it("kontrakt wierszy: te same klucze w PL i EN, etykiety unikalne i niepuste", () => {
    const keys = PARTICIPANT_TX_DETAIL_LABELS[type];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0]).toBe("event");
    for (const lang of LANGS) {
      const details = participantDemoData(type, lang).details;
      const labels = txCopy(type, lang).labels;
      expect(details.map((d) => d.label)).toEqual(keys.map((key) => labels[key]));
      expect(new Set(details.map((d) => d.label)).size).toBe(keys.length);
      for (const detail of details) {
        expect(detail.label.trim().length).toBeGreaterThan(2);
        expect(detail.value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("temat ma slot `{subject}` z tytułem wydarzenia i markę", () => {
    for (const lang of LANGS) {
      const withTitle = txSubject(type, lang, { subject: "Forum 2030" });
      expect(withTitle).toContain(" - Forum 2030");
      expect(withTitle.endsWith(" | New European Strategies")).toBe(true);
      expect(txSubject(type, lang, {})).not.toContain(" - ");
    }
    expect(txSubject(type, "pl", {})).not.toBe(txSubject(type, "en", {}));
  });

  it("polska treść nie zdradza płci odbiorcy", () => {
    const c = txCopy(type, "pl");
    for (const text of [c.preview, c.heading, c.intro, c.note, c.cta, c.eyebrow]) {
      expect(text, text).not.toMatch(/(łeś|łaś|łabyś|łbyś)\b/);
      expect(text, text).not.toMatch(/[a-ząćęłńóśźż]\/[a-ząćęłńóśźż]/i);
    }
  });

  it.each(LANGS)("render %s: marka, preheader, przycisk, wiersze, bez `{` i `}`", async (lang) => {
    const preview = await renderTxEmailPreview(type, lang, "Anna", "unknown");
    const demo = participantDemoData(type, lang);
    const c = txCopy(type, lang);

    expect(preview.subject).toBe(txSubject(type, lang, { subject: demo.subjectName }));
    expect(preview.preview).toBe(c.preview);
    expect(preview.html).toContain("New European Strategies");
    expect(preview.html).toContain(demo.ctaUrl.replaceAll("&", "&amp;"));
    expect(preview.text).toContain(c.cta);
    for (const detail of demo.details) {
      expect(preview.text).toContain(detail.label);
      expect(preview.text).toContain(detail.value);
    }
    for (const rendered of [preview.subject, preview.preview, preview.text]) {
      expect(rendered).not.toMatch(/[{}]/);
      expect(rendered).not.toMatch(/\b(undefined|NaN|null)\b/);
    }
  });
});
