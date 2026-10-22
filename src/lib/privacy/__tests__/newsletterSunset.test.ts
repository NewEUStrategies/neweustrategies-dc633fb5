// Wygaszanie newslettera (I9d-Y1) - stałe czyste: treść domyślna w limitach,
// nadpisania z panelu (puste = domyślne, za długie ODRZUCONE, nie przycięte),
// zmienne, okno wysyłki w czasie polskim i adres linku.
import { describe, expect, it } from "vitest";

import { DATA_RETENTION_RULES } from "../dataRetention";
import {
  copyLength,
  interpolateSunsetCopy,
  isNewsletterSunsetMailWindow,
  NEWSLETTER_KEEP_TOKEN_TTL_DAYS,
  NEWSLETTER_SUNSET_COPY_FIELDS,
  NEWSLETTER_SUNSET_COPY_LIMITS,
  NEWSLETTER_SUNSET_DEFAULT_COPY,
  NEWSLETTER_SUNSET_EMPTY_OVERRIDES,
  NEWSLETTER_SUNSET_MAIL_LABEL,
  NewsletterSunsetCopyOverridesSchema,
  newsletterKeepUrl,
  parseNewsletterSunsetOverrides,
  resolveNewsletterSunsetCopy,
} from "../newsletterSunset";
import { NEWSLETTER_KEEP_API_PATH } from "../newsletterKeep";
import { emailCategoryForLabel } from "@/lib/email/suppressionPolicy";

const VALUES = { firstName: "Anna", daysLeft: "30", deleteDate: "21 listopada 2026" };

function overrides(patch: { pl?: Record<string, string>; en?: Record<string, string> }) {
  return {
    pl: { ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.pl, ...patch.pl },
    en: { ...NEWSLETTER_SUNSET_EMPTY_OVERRIDES.en, ...patch.en },
  };
}

describe("treść prośby o potwierdzenie", () => {
  it("treść domyślna PL i EN: każde pole niepuste i w limicie panelu", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const field of NEWSLETTER_SUNSET_COPY_FIELDS) {
        const value = NEWSLETTER_SUNSET_DEFAULT_COPY[lang][field];
        expect(value.trim(), `${lang}.${field}`).not.toBe("");
        expect(copyLength(value), `${lang}.${field}`).toBeLessThanOrEqual(
          NEWSLETTER_SUNSET_COPY_LIMITS[field],
        );
      }
    }
    // Termin reakcji w treści domyślnej pochodzi ze zmiennej, nie z cyfry.
    expect(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.note).toContain("{daysLeft}");
    expect(NEWSLETTER_SUNSET_DEFAULT_COPY.en.note).toContain("{deleteDate}");
  });

  it("puste pole = domyślne, pole z panelu wygrywa, zmienne podstawione", () => {
    const resolved = resolveNewsletterSunsetCopy(
      overrides({ pl: { heading: "  {firstName}, zostajesz z nami?  " } }),
      "pl",
      VALUES,
    );
    expect(resolved.heading).toBe("Anna, zostajesz z nami?");
    expect(resolved.cta).toBe(NEWSLETTER_SUNSET_DEFAULT_COPY.pl.cta);
    expect(resolved.note).toContain("w ciągu 30 dni (do 21 listopada 2026)");
  });

  it("pole puste PO podstawieniu (osoba bez imienia) wraca do domyślnego", () => {
    const resolved = resolveNewsletterSunsetCopy(
      overrides({ en: { subject: "{firstName}" } }),
      "en",
      { ...VALUES, firstName: "" },
    );
    expect(resolved.subject).toBe(NEWSLETTER_SUNSET_DEFAULT_COPY.en.subject);
  });

  it("nieznana zmienna znika, podwójne spacje znikają", () => {
    expect(interpolateSunsetCopy("Hej {imie} {firstName}!", VALUES)).toBe("Hej Anna!");
  });

  it("zapis z panelu: za długie pole ODRZUCONE (nie przycięte), znaki jak `char_length`", () => {
    const max = NEWSLETTER_SUNSET_COPY_LIMITS.cta;
    expect(
      NewsletterSunsetCopyOverridesSchema.safeParse(overrides({ pl: { cta: "x".repeat(max + 1) } }))
        .success,
    ).toBe(false);
    // Emoji = jeden znak (punkt kodowy), choć to dwie jednostki UTF-16.
    const emoji = NewsletterSunsetCopyOverridesSchema.parse(
      overrides({ pl: { cta: "😀".repeat(max) } }),
    );
    expect(emoji.pl.cta).toBe("😀".repeat(max));
    // Kształt ścisły: nieznane pole i brak języka odrzucone.
    expect(
      NewsletterSunsetCopyOverridesSchema.safeParse({
        ...overrides({}),
        pl: { ...overrides({}).pl, footer: "x" },
      }).success,
    ).toBe(false);
    expect(NewsletterSunsetCopyOverridesSchema.safeParse({ pl: overrides({}).pl }).success).toBe(
      false,
    );
  });

  it("odczyt z bazy jest tolerancyjny: zły kształt, brak pól, pole ponad limit = domyślne", () => {
    expect(parseNewsletterSunsetOverrides(null)).toEqual(NEWSLETTER_SUNSET_EMPTY_OVERRIDES);
    expect(parseNewsletterSunsetOverrides([1, 2])).toEqual(NEWSLETTER_SUNSET_EMPTY_OVERRIDES);
    const parsed = parseNewsletterSunsetOverrides({
      pl: { subject: "Temat", cta: "x".repeat(NEWSLETTER_SUNSET_COPY_LIMITS.cta + 1), extra: 1 },
      en: "zepsute",
    });
    expect(parsed.pl.subject).toBe("Temat");
    expect(parsed.pl.cta).toBe("");
    expect(parsed.en).toEqual(NEWSLETTER_SUNSET_EMPTY_OVERRIDES.en);
    expect(Object.keys(parsed.pl)).toEqual([...NEWSLETTER_SUNSET_COPY_FIELDS]);
  });
});

describe("okno wysyłki próśb (czas polski)", () => {
  it("08:09-17:59 czasu polskiego, minuta 9 co 10 minut", () => {
    // Zima (CET = UTC+1): 07:09 UTC = 08:09 w Polsce.
    expect(isNewsletterSunsetMailWindow(new Date("2026-12-01T07:09:00Z"))).toBe(true);
    expect(isNewsletterSunsetMailWindow(new Date("2026-12-01T06:59:00Z"))).toBe(false);
    expect(isNewsletterSunsetMailWindow(new Date("2026-12-01T16:59:00Z"))).toBe(true);
    expect(isNewsletterSunsetMailWindow(new Date("2026-12-01T17:09:00Z"))).toBe(false);
    // Lato (CEST = UTC+2): 06:19 UTC = 08:19 w Polsce.
    expect(isNewsletterSunsetMailWindow(new Date("2026-07-01T06:19:00Z"))).toBe(true);
    expect(isNewsletterSunsetMailWindow(new Date("2026-07-01T05:59:00Z"))).toBe(false);
    // Poza minutą 9 - nie (pełne dziesiątki, piątki i minuta 7 retencji
    // należą do innych zadań ticku).
    for (const minute of [0, 3, 5, 7]) {
      const at = new Date(Date.UTC(2026, 11, 1, 10, minute));
      expect(isNewsletterSunsetMailWindow(at), `minuta ${minute}`).toBe(false);
    }
  });
});

describe("link i kanał wysyłki", () => {
  it("link wskazuje endpoint (nie stronę), bez podwójnego ukośnika, z językiem", () => {
    expect(newsletterKeepUrl("https://nes.example/", "kabc", "en")).toBe(
      `https://nes.example${NEWSLETTER_KEEP_API_PATH}?token=kabc&lang=en`,
    );
    expect(newsletterKeepUrl("https://nes.example", "k+/=")).toBe(
      `https://nes.example${NEWSLETTER_KEEP_API_PATH}?token=k%2B%2F%3D`,
    );
  });

  it("ważność linku = termin reakcji + najdalsze przesunięcie karencji", () => {
    expect(NEWSLETTER_KEEP_TOKEN_TTL_DAYS).toBe(
      DATA_RETENTION_RULES.newsletterResponseDays + DATA_RETENTION_RULES.postponeMaxDays,
    );
  });

  it("etykieta wysyłki to poczta masowa (lista wyłączeń blokuje każdy powód)", () => {
    expect(emailCategoryForLabel(NEWSLETTER_SUNSET_MAIL_LABEL)).toBe("bulk");
  });
});
