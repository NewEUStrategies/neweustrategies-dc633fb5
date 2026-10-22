// Podgląd maila ścieżki w przeglądarce (S8, Z-S5-08).
//
// CO TEN PLIK DOWODZI.
//   1. PARYTET Z WYSYŁKĄ: dla każdego maila 14 szablonów (PL i EN) i dla treści
//      z wrogimi wartościami zmiennych podgląd daje ZNAK W ZNAK ten sam temat
//      i HTML co `renderJourneyEmail` (render.server.ts) bez wiadomości i bez
//      wypisu. Stronę serwera składamy NIEZALEŻNIE od podglądu: wybór języka,
//      tematu i preheadera piszemy tu wprost jak `journey_contact_for_send`
//      (EN tylko z tematem EN), adresy serwisu bierzemy z RUNNERA.
//   2. Te same powody wstrzymania kroku (`doc_invalid`, `subject_empty`,
//      `doc_empty`) co wyjątki renderu serwera, w tej samej kolejności.
//   3. Zapis treści przycina napisy i puste EN zamienia w NULL - podgląd
//      liczy język wysyłki z tej postaci (spacje w temacie EN = wersja PL).
//   4. Decyzja Z-S5-08: `variables.ts` nie importuje nic w czasie działania
//      (same typy), `emailPreview.ts` nie sięga do modułów `.server`, a
//      `render.server.ts` re-eksportuje `substituteDocVariables` z liścia.
//   5. Ostrzeżenia o zmiennych i klucze słownika podglądu.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/transactional.server", () => ({ enqueueRawEmail: vi.fn() }));
vi.mock("@/lib/email/reputationGate.server", () => ({ evaluateSendGate: vi.fn() }));

import { bezKomentarzy } from "@/lib/ci/sourceScan";
import "@/lib/i18n-admin-journeys-editor";
import {
  JourneyRenderError,
  renderJourneyEmail,
  substituteDocVariables as substituteFromServer,
} from "@/lib/journeys/render.server";
import { button, emailDoc, footnote, heading, paragraph } from "@/lib/journeys/templates/doc";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import {
  JOURNEY_VARIABLE_SAMPLES,
  escapeHtml,
  journeyUrlVariables,
  substituteDocVariables,
  type JourneyVariableValues,
} from "@/lib/journeys/variables";
import { journeyUrlVariables as runnerUrlVariables } from "@/lib/server/journeysRunner.server";
import { realT } from "@/test/i18nReal";
import {
  JOURNEY_PREVIEW_ERROR_KEY,
  JOURNEY_PREVIEW_NOTE_KEY,
  journeyEmailPreview,
  journeyEmailPreviewDocument,
  journeyEmailVariableIssues,
  previewLocale,
  previewVariables,
  storedEmailContent,
  type JourneyEmailPreviewContent,
} from "../emailPreview";

const ORIGIN = "https://nes.example.test";

/** Wiersz `journey_email_contents` po zapisie RPC (btrim + NULLIF dla EN i preheaderów). */
function savedRow(content: JourneyEmailPreviewContent) {
  const nullIfBlank = (value: string | null) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    subject_pl: content.subjectPl.trim(),
    subject_en: nullIfBlank(content.subjectEn),
    preheader_pl: nullIfBlank(content.preheaderPl),
    preheader_en: nullIfBlank(content.preheaderEn),
    doc: content.doc,
  };
}

/**
 * Strona serwera złożona BEZ kodu podglądu: `journey_contact_for_send`
 * (język, temat, preheader) + adresy z runnera + `renderJourneyEmail`.
 */
function serverRender(
  content: JourneyEmailPreviewContent,
  lang: "pl" | "en",
  vars?: JourneyVariableValues,
) {
  const row = savedRow(content);
  const locale = lang === "en" && row.subject_en !== null ? "en" : "pl";
  return renderJourneyEmail({
    doc: row.doc,
    subject: (locale === "en" ? row.subject_en : row.subject_pl) ?? "",
    preheader: locale === "en" ? row.preheader_en : row.preheader_pl,
    locale,
    vars: vars ?? { ...JOURNEY_VARIABLE_SAMPLES[locale], ...runnerUrlVariables(ORIGIN) },
    origin: ORIGIN,
    messageId: null,
    unsubscribeUrl: null,
  });
}

function templateEmails(): { label: string; content: JourneyEmailPreviewContent }[] {
  return Object.entries(JOURNEY_TEMPLATES).flatMap(([key, template]) =>
    template.emails.map((email) => ({
      label: `${key}/${email.nodeId}`,
      content: {
        subjectPl: email.subject.pl,
        subjectEn: email.subject.en,
        preheaderPl: email.preheader.pl,
        preheaderEn: email.preheader.en,
        doc: email.doc,
      },
    })),
  );
}

const HOSTILE_DOC = emailDoc(
  heading("h1", "Witaj, {{first_name}} {{last_name}}", "Hello, {{first_name}}"),
  paragraph(
    "p1",
    'Plan: <b>{{plan_name}}</b> &amp; {{nieznana}} - <a href="{{pricing_url}}">cennik</a>',
    "Plan: <b>{{plan_name}}</b>",
  ),
  button("b1", "Cennik {{site_name}}", "Pricing {{site_name}}", "{{pricing_url}}?utm=journey&x=1"),
  button("b2", "Konto", "Account", "{{site_url}}/u/{{first_name}}"),
  {
    id: "i1",
    type: "image",
    url: "{{site_url}}/logo.png",
    href: "{{account_url}}",
    alt: '{{site_name}} "logo"',
  },
  {
    id: "q1",
    type: "quote",
    text: { pl: "„{{event_title}}”", en: '"{{event_title}}"' },
    attribution: { pl: "{{club_name}}", en: "{{club_name}}" },
  },
  footnote("f1", "Stopka {{site_name}} {{trial_ends_at}}", "Footer {{site_name}}"),
);

const HOSTILE_VARS: JourneyVariableValues = {
  first_name: '<img src=x onerror="alert(1)">',
  last_name: "O'Brien & Syn",
  site_name: 'NES "Strategie" <i>',
  plan_name: "Pro & More",
  event_title: "Forum </table>",
  club_name: "Klub ' \" &",
  trial_ends_at: null,
  ...journeyUrlVariables(ORIGIN),
};

describe("parytet podglądu z wysyłką (Z-S5-08)", () => {
  const emails = templateEmails();

  it("szablony niosą maile do sprawdzenia (kanarek - inaczej pętle niżej byłyby puste)", () => {
    expect(emails.length).toBeGreaterThan(20);
  });

  it.each(["pl", "en"] as const)(
    "każdy mail szablonu: temat, preheader i HTML jak `renderJourneyEmail` (%s)",
    (lang) => {
      for (const { label, content } of emails) {
        const preview = journeyEmailPreview(content, { lang, origin: ORIGIN });
        const server = serverRender(content, lang);
        expect(preview.ok, label).toBe(true);
        if (!preview.ok) continue;
        expect(preview.subject, label).toBe(server.subject);
        expect(preview.html, label).toBe(server.html);
        // Preheader w ukrytym bloku, escapowany jak w wysyłce.
        if (preview.preheader) expect(server.html, label).toContain(escapeHtml(preview.preheader));
      }
    },
  );

  it.each(["pl", "en"] as const)(
    "wrogie wartości zmiennych (HTML, cudzysłowy, dane kontaktu w adresie) - ten sam HTML (%s)",
    (lang) => {
      const content: JourneyEmailPreviewContent = {
        subjectPl: "Cześć {{first_name}} - {{plan_name}}",
        subjectEn: "Hi {{first_name}} - {{plan_name}}",
        preheaderPl: "Dla {{last_name}} <b>",
        preheaderEn: null,
        doc: HOSTILE_DOC,
      };
      const preview = journeyEmailPreview(content, { lang, origin: ORIGIN, vars: HOSTILE_VARS });
      const server = serverRender(content, lang, HOSTILE_VARS);
      expect(preview).toMatchObject({ ok: true, subject: server.subject, html: server.html });
      // Dane kontaktu nie wchodzą do adresu, a HTML z imienia jest escapowany.
      expect(server.html).not.toContain("/u/<img");
      expect(server.html).not.toContain('<img src=x onerror="alert(1)">');
    },
  );

  it("brak tematu EN (także same spacje) = wysyłka po polsku i flaga języka zastępczego", () => {
    for (const subjectEn of [null, "", "   "]) {
      const content: JourneyEmailPreviewContent = {
        subjectPl: "  Temat {{first_name}}  ",
        subjectEn,
        preheaderPl: "Zapowiedź",
        preheaderEn: "Teaser",
        doc: HOSTILE_DOC,
      };
      const preview = journeyEmailPreview(content, { lang: "en", origin: ORIGIN });
      const server = serverRender(content, "en");
      expect(preview).toMatchObject({
        ok: true,
        locale: "pl",
        fallbackLocale: true,
        subject: "Temat Anna",
        preheader: "Zapowiedź",
        html: server.html,
      });
    }
  });

  it("temat EN bez preheadera EN - mail bez ukrytego preheadera (jak NULL po zapisie)", () => {
    const content: JourneyEmailPreviewContent = {
      subjectPl: "Temat",
      subjectEn: "Subject",
      preheaderPl: "Zapowiedź",
      preheaderEn: "  ",
      doc: HOSTILE_DOC,
    };
    const preview = journeyEmailPreview(content, { lang: "en", origin: ORIGIN });
    expect(preview).toMatchObject({ ok: true, locale: "en", fallbackLocale: false, preheader: "" });
    expect(preview.ok && preview.html).toBe(serverRender(content, "en").html);
    expect(preview.ok && preview.html).not.toContain("display:none");
  });

  it("powody wstrzymania kroku i ich kolejność = wyjątki renderu serwera", () => {
    const cases: { content: JourneyEmailPreviewContent; lang: "pl" | "en"; code: string }[] = [
      {
        content: { subjectPl: "", subjectEn: null, preheaderPl: null, preheaderEn: null, doc: {} },
        lang: "pl",
        code: "doc_invalid",
      },
      {
        content: {
          subjectPl: "{{nieznana}} ",
          subjectEn: null,
          preheaderPl: null,
          preheaderEn: null,
          doc: emailDoc(),
        },
        lang: "pl",
        code: "subject_empty",
      },
      {
        content: {
          subjectPl: "Temat",
          subjectEn: "Subject",
          preheaderPl: null,
          preheaderEn: null,
          doc: emailDoc(heading("h1", "Tylko po polsku", "")),
        },
        lang: "en",
        code: "doc_empty",
      },
    ];
    for (const { content, lang, code } of cases) {
      const preview = journeyEmailPreview(content, { lang, origin: ORIGIN });
      expect(preview, code).toMatchObject({ ok: false, error: code });
      let thrown: unknown = null;
      try {
        serverRender(content, lang);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, code).toBeInstanceOf(JourneyRenderError);
      expect((thrown as JourneyRenderError).code, code).toBe(code);
    }
  });

  it("adresy serwisu = ścieżki runnera; próbki podglądu bez danych spoza słownika", () => {
    for (const origin of [ORIGIN, "http://localhost:3000", "https://a.test"]) {
      expect(journeyUrlVariables(origin)).toEqual(runnerUrlVariables(origin));
    }
    expect(previewVariables("en", ORIGIN)).toEqual({
      ...JOURNEY_VARIABLE_SAMPLES.en,
      ...runnerUrlVariables(ORIGIN),
    });
  });
});

describe("postać po zapisie i język wysyłki", () => {
  it("przycina napisy, puste EN i preheadery zamienia w NULL", () => {
    expect(
      storedEmailContent({
        subjectPl: "  Temat ",
        subjectEn: " ",
        preheaderPl: "",
        preheaderEn: " Teaser ",
        doc: null,
      }),
    ).toEqual({
      subjectPl: "Temat",
      subjectEn: null,
      preheaderPl: null,
      preheaderEn: "Teaser",
      doc: null,
    });
  });

  it("PL zawsze po polsku; EN tylko z tematem EN", () => {
    expect(previewLocale({ subjectEn: "Hi" }, "pl")).toEqual({
      locale: "pl",
      fallbackLocale: false,
    });
    expect(previewLocale({ subjectEn: "Hi" }, "en")).toEqual({
      locale: "en",
      fallbackLocale: false,
    });
    expect(previewLocale({ subjectEn: null }, "en")).toEqual({
      locale: "pl",
      fallbackLocale: true,
    });
  });

  it("dokument ramki podglądu niesie treść maila w całości", () => {
    const preview = journeyEmailPreview(
      { subjectPl: "T", subjectEn: null, preheaderPl: null, preheaderEn: null, doc: HOSTILE_DOC },
      { lang: "pl", origin: ORIGIN },
    );
    if (!preview.ok) throw new Error("test: podgląd powinien się udać");
    const document = journeyEmailPreviewDocument(preview.html);
    expect(document.startsWith("<!doctype html>")).toBe(true);
    expect(document).toContain(preview.html);
  });
});

describe("ostrzeżenia o zmiennych", () => {
  it("nieznane znaczniki z obu języków i całego dokumentu; dane kontaktu w adresach", () => {
    const issues = journeyEmailVariableIssues({
      subjectPl: "{{first_name}} {{imie}}",
      subjectEn: "{{name}}",
      preheaderPl: null,
      preheaderEn: "{{ coupon }}",
      doc: HOSTILE_DOC,
    });
    expect(issues.unknown).toEqual(["coupon", "imie", "name", "nieznana"]);
    expect(issues.blankInUrls).toEqual(["first_name"]);
  });

  it("czysta treść - brak ostrzeżeń", () => {
    expect(
      journeyEmailVariableIssues({
        subjectPl: "Cześć {{first_name}}",
        subjectEn: null,
        preheaderPl: null,
        preheaderEn: null,
        doc: emailDoc(button("b", "A", "B", "{{pricing_url}}")),
      }),
    ).toEqual({ unknown: [], blankInUrls: [] });
  });
});

describe("Z-S5-08: kod podglądu nie ciągnie serwera do przeglądarki", () => {
  const importsOf = (path: string) =>
    [
      ...bezKomentarzy(readFileSync(path, "utf8")).matchAll(
        /^\s*import\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm,
      ),
    ].map((match) => ({ typeOnly: Boolean(match[1]), from: match[2] }));

  it("`variables.ts` importuje wyłącznie typy (moduł bez zależności w czasie działania)", () => {
    const imports = importsOf("src/lib/journeys/variables.ts");
    expect(imports).toEqual([{ typeOnly: true, from: "@/lib/newsletter/emailDoc" }]);
  });

  it("`emailPreview.ts` nie importuje modułów `.server` ani `render.server`", () => {
    const sources = importsOf("src/lib/admin/journeys/emailPreview.ts").map((i) => i.from);
    expect(sources.filter((from) => /\.server\b|render\.server/.test(from))).toEqual([]);
    expect(sources).toContain("@/lib/journeys/variables");
  });

  it("`render.server.ts` używa podstawiania z liścia - jedna implementacja", () => {
    expect(substituteFromServer).toBe(substituteDocVariables);
    const code = bezKomentarzy(readFileSync("src/lib/journeys/render.server.ts", "utf8"));
    expect(code).not.toMatch(/function substituteDocVariables/);
  });
});

describe("słownik podglądu", () => {
  it.each(["pl", "en"] as const)("każdy klucz podglądu ma zdanie (%s)", (lang) => {
    const t = realT(lang);
    for (const key of [
      ...Object.values(JOURNEY_PREVIEW_ERROR_KEY),
      ...Object.values(JOURNEY_PREVIEW_NOTE_KEY),
    ]) {
      const text = t(key, { name: "Anna Kowalska", list: "x" });
      expect(text, key).not.toBe(key);
      expect(text.trim(), key).not.toBe("");
    }
  });
});
