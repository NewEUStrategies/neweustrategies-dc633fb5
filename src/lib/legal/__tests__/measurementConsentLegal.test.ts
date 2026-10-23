// Polityki komunikacji i prywatności a OSOBNA zgoda na pomiar otwarć
// i kliknięć (I9d-Y2b, decyzje właściciela 2026-10-23: D1 wariant (b) -
// każda zgoda ma osobne pole; D2 - pomiar tylko dla skrzynki potwierdzonej
// przez jej właściciela).
//
// PO CO. Polityka to informacja z art. 13 RODO - musi mówić to, co robi
// kod. Zdanie „każda zgoda ma osobne pole i osobną treść" było w wariancie
// (a) nieprawdziwe (pomiar w treści zgody na newsletter). Ten plik pilnuje,
// że polityki opisują osobne, niezaznaczone pole, potwierdzenie przez
// właściciela skrzynki, osobne wycofanie i koniec zgody z końcem subskrypcji
// - w obu językach - oraz że linki z treści pola pomiaru i stopki prowadzą do
// istniejących sekcji.
import { describe, expect, it } from "vitest";

import { COMMUNICATIONS_CONTENT } from "@/lib/legal/content/communications";
import { PRIVACY_CONTENT } from "@/lib/legal/content/privacy";
import { PRIVACY_UPDATED } from "@/lib/legal/entity";
import { COMMUNICATIONS_UPDATED } from "@/lib/legal/registration";
import { newsletterConsentSegments } from "@/lib/newsletter/consentText";
import { measurementConsentSegments } from "@/lib/newsletter/measurementConsentText";
import { MEASUREMENT_FOOTER_COPY } from "@/lib/privacy/measurement";
import type { LegalDocContent } from "@/lib/legal/types";

type Lang = "pl" | "en";

function sectionText(doc: LegalDocContent, lang: Lang, id: string): string {
  const section = doc[lang].sections.find((s) => s.id === id);
  if (!section) throw new Error(`brak sekcji ${id} (${lang})`);
  return [section.heading, ...(section.paragraphs ?? []), ...(section.bullets ?? [])].join("\n");
}

function docText(doc: LegalDocContent, lang: Lang): string {
  return doc[lang].sections.map((s) => sectionText(doc, lang, s.id)).join("\n");
}

describe("polityka komunikacji - zapis: każda zgoda ma osobne pole (wariant (b))", () => {
  it("PL: zdanie o osobnych polach zostaje i jest prawdziwe - pomiar ma własne, niezaznaczone pole", () => {
    const text = sectionText(COMMUNICATIONS_CONTENT, "pl", "zapis");
    expect(text).toContain("każda zgoda ma osobne pole i osobną treść");
    expect(text).toContain(
      "Zgoda na pomiar otwarć i kliknięć ma osobne, domyślnie niezaznaczone pole i własną treść.",
    );
    expect(text).toMatch(/Newsletter otrzymasz także bez niej/);
    // Wariant (a) zniknął: treść zgody na newsletter NIE informuje o pomiarze.
    expect(text).not.toMatch(/Treść zgody na newsletter informuje także o pomiarze/);
  });

  it("EN: the same rules", () => {
    const text = sectionText(COMMUNICATIONS_CONTENT, "en", "zapis");
    expect(text).toContain("every consent has its own field and its own text");
    expect(text).toContain(
      "Consent to measuring opens and clicks has its own unticked box and its own text.",
    );
    expect(text).not.toMatch(/newsletter consent text also tells you about measuring/);
  });
});

describe("polityka komunikacji - pomiar: osobna zgoda, potwierdzenie skrzynką, wycofanie", () => {
  it.each(["pl", "en"] as const)(
    "%s: pole nie włącza pomiaru, działa potwierdzenie właściciela skrzynki",
    (lang) => {
      const text = sectionText(COMMUNICATIONS_CONTENT, lang, "pomiar");
      if (lang === "pl") {
        expect(text).toMatch(/osobną zgodą na pomiar/);
        expect(text).toMatch(/Zaznaczenie pola w formularzu nie włącza pomiaru/);
        expect(text).toMatch(/potwierdzisz ją przyciskiem na stronie/);
        expect(text).toMatch(/aktywnym subskrybentem/);
        expect(text).toMatch(/nie jest traktowana jako zgoda na pomiar/);
        expect(text).toMatch(/kończy także zgodę na pomiar/);
        expect(text).toMatch(/double opt-in/);
        // Sam fakt zgody na newsletter nie daje pomiaru (wariant (a) wycofany).
        expect(text).not.toMatch(/zgoda na newsletter obejmuje pomiar/);
      } else {
        expect(text).toMatch(/separate consent to measurement/);
        expect(text).toMatch(/Ticking the box in a form does not switch measurement on/);
        expect(text).toMatch(/confirm it with the button on the page/);
        expect(text).toMatch(/active subscriber/);
        expect(text).toMatch(/is not treated as consent to measurement/);
        expect(text).toMatch(/also ends consent to measurement/);
        expect(text).not.toMatch(/newsletter consent covers measurement/);
      }
    },
  );

  it.each(["pl", "en"] as const)(
    "%s: osobne wycofanie linkiem ze stopki o tej samej etykiecie co mail",
    (lang) => {
      const text = sectionText(COMMUNICATIONS_CONTENT, lang, "pomiar");
      expect(text).toContain(MEASUREMENT_FOOTER_COPY[lang].link);
    },
  );

  it("PL i EN mają tyle samo punktów w sekcjach zapisu i pomiaru", () => {
    for (const id of ["zapis", "pomiar"]) {
      const pl = COMMUNICATIONS_CONTENT.pl.sections.find((s) => s.id === id);
      const en = COMMUNICATIONS_CONTENT.en.sections.find((s) => s.id === id);
      expect(en?.bullets?.length, id).toBe(pl?.bullets?.length);
      expect(en?.paragraphs?.length ?? 0, id).toBe(pl?.paragraphs?.length ?? 0);
    }
  });
});

describe("linki z treści zgód prowadzą do istniejących sekcji polityki komunikacji", () => {
  it.each(["pl", "en"] as const)(
    "%s: #pomiar (pole pomiaru) i #rezygnacja (zgoda na newsletter)",
    (lang) => {
      const ids = new Set(COMMUNICATIONS_CONTENT[lang].sections.map((s) => s.id));
      const anchors = [...measurementConsentSegments(lang), ...newsletterConsentSegments(lang)]
        .filter((part): part is { href: string; label: string } => typeof part !== "string")
        .map((part) => part.href)
        .filter((href) => href.includes("/komunikacja-i-marketing#"))
        .map((href) => href.split("#")[1]);
      expect(anchors).toEqual(expect.arrayContaining(["pomiar", "rezygnacja"]));
      for (const anchor of anchors) expect(ids.has(anchor), anchor).toBe(true);
    },
  );
});

describe("polityka prywatności - pomiar za osobną zgodą potwierdzoną przyciskiem", () => {
  it("PL i EN: dane newslettera opisują osobną zgodę i potwierdzenie z linku", () => {
    const pl = docText(PRIVACY_CONTENT, "pl");
    const en = docText(PRIVACY_CONTENT, "en");
    expect(pl).toMatch(
      /wyłącznie za osobną zgodą na pomiar, potwierdzoną przyciskiem na stronie z linku w wiadomości wysłanej na Twój adres/,
    );
    expect(en).toMatch(
      /only with separate consent to measurement, confirmed with the button on the page opened from a link in an email sent to your address/,
    );
    expect(pl).not.toMatch(/zgodą obejmującą pomiar/);
    expect(en).not.toMatch(/consent that covers measurement/);
  });
});

describe("daty wersji polityk (I9d-Y2b)", () => {
  it("polityka komunikacji i prywatności: 2026-10-23, widoczne w nagłówku dokumentu", () => {
    expect(COMMUNICATIONS_UPDATED).toBe("2026-10-23");
    expect(PRIVACY_UPDATED).toBe("2026-10-23");
    expect(COMMUNICATIONS_CONTENT.pl.updated).toContain("2026-10-23");
    expect(COMMUNICATIONS_CONTENT.en.updated).toContain("2026-10-23");
    expect(PRIVACY_CONTENT.pl.updated).toContain("2026-10-23");
    expect(PRIVACY_CONTENT.en.updated).toContain("2026-10-23");
  });
});
