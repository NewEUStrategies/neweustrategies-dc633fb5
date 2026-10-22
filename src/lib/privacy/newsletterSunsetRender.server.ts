// Render prośby o potwierdzenie subskrypcji (wygaszanie, I9d-Y1): treść
// z panelu albo domyślna -> temat, HTML i tekst dla kolejki poczty.
//
// JEDNO miejsce renderu dla wysyłki (`newsletterSunsetMail.server.ts`)
// i podglądu w panelu (`previewNewsletterSunsetEmail`) - admin widzi
// dokładnie ten mail, który wyjdzie. React Email ładowany DYNAMICZNIE: moduł
// jest importowany leniwie z kroku `jobs-tick` i z funkcji serwerowej, a sam
// render dzieje się dopiero na ścieżce, która naprawdę coś wysyła.
import * as React from "react";

import { uiLocale } from "@/lib/i18n/format";
import { DATA_RETENTION_RULES } from "./dataRetention";
import {
  resolveNewsletterSunsetCopy,
  type NewsletterSunsetCopyOverrides,
  type NewsletterSunsetLang,
} from "./newsletterSunset";

export interface NewsletterSunsetRenderInput {
  lang: NewsletterSunsetLang;
  overrides: NewsletterSunsetCopyOverrides;
  firstName: string | null;
  /** Najwcześniejsza chwila usunięcia adresu (termin reakcji). */
  deleteAfter: Date;
  keepUrl: string;
  unsubscribeUrl: string | null;
  /** Origin serwisu najemcy (logo i stopka prowadzą na jego stronę). */
  siteUrl: string;
}

export interface NewsletterSunsetRendered {
  subject: string;
  html: string;
  text: string;
}

/** Data usunięcia w języku maila, w strefie redakcji (termin to doba w Polsce). */
export function formatSunsetDeleteDate(at: Date, lang: NewsletterSunsetLang): string {
  return new Intl.DateTimeFormat(uiLocale(lang), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(at);
}

export async function renderNewsletterSunsetEmail(
  input: NewsletterSunsetRenderInput,
): Promise<NewsletterSunsetRendered> {
  const firstName = input.firstName?.trim() || null;
  const copy = resolveNewsletterSunsetCopy(input.overrides, input.lang, {
    firstName: firstName ?? "",
    daysLeft: String(DATA_RETENTION_RULES.newsletterResponseDays),
    deleteDate: formatSunsetDeleteDate(input.deleteAfter, input.lang),
  });
  const [{ render }, { NewsletterSunsetEmail }] = await Promise.all([
    import("@react-email/render"),
    import("./newsletterSunsetEmail"),
  ]);
  const element = React.createElement(NewsletterSunsetEmail, {
    lang: input.lang,
    siteUrl: input.siteUrl,
    copy,
    firstName,
    keepUrl: input.keepUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  });
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject: copy.subject, html, text };
}
