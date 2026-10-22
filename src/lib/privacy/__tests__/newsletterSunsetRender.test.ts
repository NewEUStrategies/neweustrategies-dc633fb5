// Render prośby o potwierdzenie subskrypcji (I9d-Y1) - PRAWDZIWY React Email
// (ten sam render co wysyłka i podgląd w panelu): PL i EN wg języka
// subskrybenta, treść z panelu ze zmiennymi, link „Chcę dalej otrzymywać"
// i wypis jednym kliknięciem.
import { describe, expect, it } from "vitest";

import {
  NEWSLETTER_SUNSET_DEFAULT_COPY,
  NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
  NEWSLETTER_SUNSET_FIXED_COPY,
} from "../newsletterSunset";
import {
  formatSunsetDeleteDate,
  renderNewsletterSunsetEmail,
} from "../newsletterSunsetRender.server";

const KEEP = "https://nes.example/api/public/newsletter/keep?token=kabc123";
const UNSUB = "https://nes.example/api/public/newsletter/unsubscribe?token=u123";
const DELETE_AFTER = new Date("2026-11-21T08:03:00Z");

function input(lang: "pl" | "en", patch: Record<string, unknown> = {}) {
  return {
    lang,
    overrides: NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
    firstName: "Anna",
    deleteAfter: DELETE_AFTER,
    keepUrl: KEEP,
    unsubscribeUrl: UNSUB,
    siteUrl: "https://nes.example",
    ...patch,
  } as Parameters<typeof renderNewsletterSunsetEmail>[0];
}

describe("prośba o potwierdzenie - render PL/EN", () => {
  it("PL: temat, nagłówek, przycisk z linkiem, termin w treści, wypis", async () => {
    const mail = await renderNewsletterSunsetEmail(input("pl"));
    expect(mail.subject).toBe(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.subject);
    expect(mail.html).toContain('lang="pl"');
    expect(mail.html).toContain(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.heading);
    expect(mail.html).toContain(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.cta);
    expect(mail.html).toContain(`href="${KEEP}"`);
    expect(mail.html).toContain(`href="${UNSUB}"`);
    expect(mail.html).toContain(NEWSLETTER_SUNSET_FIXED_COPY.pl.unsubscribeLink);
    expect(mail.html).toContain("w ciągu 30 dni (do 21 listopada 2026)");
    expect(mail.html).toContain("Dzień dobry");
    expect(mail.text).toContain(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.cta);
    expect(mail.text).toContain(KEEP);
  });

  it("EN: treść angielska, data po angielsku, powitanie imieniem", async () => {
    const mail = await renderNewsletterSunsetEmail(input("en"));
    expect(mail.subject).toBe(NEWSLETTER_SUNSET_DEFAULT_COPY.en.subject);
    expect(mail.html).toContain('lang="en"');
    expect(mail.html).toContain(NEWSLETTER_SUNSET_DEFAULT_COPY.en.cta);
    expect(mail.html).toContain("within 30 days (by 21 November 2026)");
    expect(mail.html).toContain("Hi Anna,");
    expect(mail.html).not.toContain(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.cta);
  });

  it("treść z panelu (z akapitami i zmiennymi) zastępuje domyślną; puste pole zostaje domyślne", async () => {
    const mail = await renderNewsletterSunsetEmail(
      input("pl", {
        overrides: {
          ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
          pl: {
            ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.pl,
            subject: "{firstName}, zostajesz?",
            intro: "Pierwszy akapit.\n\nDrugi akapit do {deleteDate}.",
          },
        },
      }),
    );
    expect(mail.subject).toBe("Anna, zostajesz?");
    expect(mail.html).toContain("Pierwszy akapit.");
    expect(mail.html).toContain("Drugi akapit do 21 listopada 2026.");
    expect(mail.html).toContain(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.cta);
  });

  it("bez imienia: powitanie ogólne; bez tokenu wypisu: bez linku wypisu", async () => {
    const mail = await renderNewsletterSunsetEmail(
      input("pl", { firstName: null, unsubscribeUrl: null }),
    );
    expect(mail.html).toContain("Dzień dobry");
    expect(mail.html).not.toContain(NEWSLETTER_SUNSET_FIXED_COPY.pl.unsubscribeLink);
  });

  it("data usunięcia w strefie redakcji (doba w Polsce, nie UTC)", () => {
    // 23:30 UTC 30.11 = 00:30 1.12 w Polsce.
    expect(formatSunsetDeleteDate(new Date("2026-11-30T23:30:00Z"), "pl")).toBe("1 grudnia 2026");
    expect(formatSunsetDeleteDate(new Date("2026-11-30T23:30:00Z"), "en")).toBe("1 December 2026");
  });
});
