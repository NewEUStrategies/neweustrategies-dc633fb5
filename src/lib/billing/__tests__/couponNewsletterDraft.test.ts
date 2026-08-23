// Szkic kampanii newslettera tworzonej z kampanii kuponowej - sześć literałów,
// które trafiają DO BAZY, a stamtąd do skrzynek subskrybentów.
//
// CO TEN PLIK DOWODZI.
//   1. ZASIĘG WYSYŁKI. Brak segmentu daje `audience_filter: {}` - czyli
//      WYSYŁKĘ DO WSZYSTKICH, nie do nikogo. To jest decyzja o tym, komu
//      rozdajemy rabat, zapisana pustym obiektem w środku mutacji.
//   2. MERGE TAG. Treść maila musi nieść `{{coupon_code}}` w OBU językach -
//      bez niego subskrybent dostaje pusty list zamiast kodu.
//   3. DEFEKT: nazwa kampanii zapisywana do bazy jest ZAWSZE po polsku,
//      a data ważności wchodzi do treści w surowym ISO.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Insertu do `newsletter_campaigns` ani cichej
// awarii aktualizacji statusu - to dowodzi test trasy kampanii.
import { describe, expect, it } from "vitest";
import { buildNewsletterDraft } from "@/lib/billing/couponNewsletterDraft";

const KAMPANIA = {
  name: "Q1 2026 VIP",
  valid_until: "2026-03-31T23:59:59.000Z",
  newsletter_segment: "vip",
};

describe("zasięg wysyłki", () => {
  it("segment ustawiony zawęża odbiorców filtrem po nazwie segmentu", () => {
    expect(buildNewsletterDraft(KAMPANIA).audience_filter).toEqual({ segment: "vip" });
  });

  it("BRAK segmentu daje pusty filtr, czyli wysyłkę do WSZYSTKICH subskrybentów", () => {
    expect(buildNewsletterDraft({ ...KAMPANIA, newsletter_segment: null }).audience_filter).toEqual(
      {},
    );
  });
});

describe("treść listu", () => {
  it("obie wersje językowe niosą merge tag, bez którego list nie zawiera kodu", () => {
    const draft = buildNewsletterDraft(KAMPANIA);
    expect(draft.html_pl).toContain("{{coupon_code}}");
    expect(draft.html_en).toContain("{{coupon_code}}");
  });

  it("kampania bezterminowa mówi to WPROST w obu językach, zamiast zostawić puste miejsce", () => {
    const draft = buildNewsletterDraft({ ...KAMPANIA, valid_until: null });
    expect(draft.html_pl).toContain("bezterminowo");
    expect(draft.html_en).toContain("unlimited");
  });

  it("temat listu niesie nazwę kampanii w obu wersjach językowych", () => {
    const draft = buildNewsletterDraft(KAMPANIA);
    expect(draft.subject_pl).toBe("Twój kod rabatowy - Q1 2026 VIP");
    expect(draft.subject_en).toBe("Your discount code - Q1 2026 VIP");
  });
});

describe("DEFEKT: nazwa kampanii i data w treści nie są zlokalizowane", () => {
  // Para `it.fails` + `it()`. Po naprawie (nazwa z klucza i18n operatora, data
  // przez `uiLocale`) usuwa się OBA RAZEM.
  it.fails("data ważności NIE POWINNA trafiać do treści listu w surowym ISO", () => {
    expect(buildNewsletterDraft(KAMPANIA).html_pl).not.toContain("2026-03-31T23:59:59.000Z");
  });

  it("STAN FAKTYCZNY: subskrybent dostaje znacznik czasu z bazy, razem ze strefą", () => {
    expect(buildNewsletterDraft(KAMPANIA).html_pl).toContain("2026-03-31T23:59:59.000Z");
    expect(buildNewsletterDraft(KAMPANIA).html_en).toContain("2026-03-31T23:59:59.000Z");
  });

  it("nazwa kampanii newslettera jest zapisywana do bazy PO POLSKU, niezależnie od operatora", () => {
    // Funkcja nie przyjmuje języka - nie ma jak zapisać jej inaczej.
    expect(buildNewsletterDraft(KAMPANIA).name).toBe("Kupony: Q1 2026 VIP");
  });
});
