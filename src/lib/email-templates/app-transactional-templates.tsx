import * as React from "react";

import type { TemplateEntry } from "./registry";
import { TxEmail } from "./transactional";
import { txSubject, type TxEmailType } from "./tx-copy";
import type { EmailLang } from "./nes-layout";

type PreviewData = Record<string, unknown>;

const SITE_URL = "https://neweuropeanstrategies.com";

function readLang(data: PreviewData): EmailLang {
  return data.lang === "en" ? "en" : "pl";
}

function readString(data: PreviewData, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function createAppEmailTemplate(
  type: TxEmailType,
  displayName: string,
  previewData: PreviewData,
): TemplateEntry {
  const Component = (data: PreviewData) => {
    const lang = readLang(data);
    return React.createElement(TxEmail, {
      type,
      lang,
      siteUrl: SITE_URL,
      firstName: readString(data, "firstName") ?? "Anna",
      vocativePl: lang === "pl" ? (readString(data, "vocativePl") ?? "Anno") : undefined,
      ctaUrl: readString(data, "ctaUrl") ?? SITE_URL,
      details: Array.isArray(data.details)
        ? data.details.filter(
            (item): item is { label: string; value: string } =>
              typeof item === "object" &&
              item !== null &&
              "label" in item &&
              "value" in item &&
              typeof item.label === "string" &&
              typeof item.value === "string",
          )
        : [],
    });
  };

  return {
    component: Component,
    displayName,
    previewData,
    subject: (data) =>
      txSubject(type, readLang(data), { subject: readString(data, "subjectName") ?? null }),
  };
}

const eventDetailsPl = [
  { label: "Wydarzenie", value: "Europejski Briefing Strategiczny" },
  { label: "Data", value: "29 lipca 2026, 18:00" },
  { label: "Miejsce", value: "Warszawa / online" },
];

export const freeRsvpPlTemplate = createAppEmailTemplate(
  "event_registered",
  "Bezpłatne RSVP - PL",
  {
    lang: "pl",
    firstName: "Anna",
    vocativePl: "Anno",
    subjectName: "Europejski Briefing Strategiczny",
    details: eventDetailsPl,
    ctaUrl: `${SITE_URL}/events`,
  },
);

export const freeRsvpEnTemplate = createAppEmailTemplate("event_registered", "Free RSVP - EN", {
  lang: "en",
  firstName: "Anna",
  subjectName: "European Strategic Briefing",
  details: [
    { label: "Event", value: "European Strategic Briefing" },
    { label: "Date", value: "29 July 2026, 18:00" },
    { label: "Location", value: "Warsaw / online" },
  ],
  ctaUrl: `${SITE_URL}/events`,
});

export const subscriptionConfirmedTemplate = createAppEmailTemplate(
  "subscription_confirmed",
  "Potwierdzenie subskrypcji",
  { lang: "pl", firstName: "Anna", vocativePl: "Anno", subjectName: "Professional" },
);

export const subscriptionRenewedTemplate = createAppEmailTemplate(
  "subscription_renewed",
  "Przedłużenie subskrypcji",
  { lang: "pl", firstName: "Anna", vocativePl: "Anno", subjectName: "Professional" },
);

export const subscriptionCanceledTemplate = createAppEmailTemplate(
  "subscription_canceled",
  "Anulowanie subskrypcji",
  { lang: "pl", firstName: "Anna", vocativePl: "Anno", subjectName: "Professional" },
);

export const subscriptionUpgradedTemplate = createAppEmailTemplate(
  "subscription_upgraded",
  "Upgrade subskrypcji",
  { lang: "pl", firstName: "Anna", vocativePl: "Anno", subjectName: "Executive" },
);

export const subscriptionDowngradedTemplate = createAppEmailTemplate(
  "subscription_downgraded",
  "Downgrade subskrypcji",
  { lang: "pl", firstName: "Anna", vocativePl: "Anno", subjectName: "Essential" },
);

export const newsletterConfirmedTemplate = createAppEmailTemplate(
  "newsletter_confirmed",
  "Potwierdzenie newslettera",
  { lang: "pl", firstName: "Anna", vocativePl: "Anno" },
);

export const donationReceivedPlTemplate = createAppEmailTemplate(
  "donation_received",
  "Potwierdzenie darowizny - PL",
  {
    lang: "pl",
    firstName: "Anna",
    vocativePl: "Anno",
    subjectName: "100,00 PLN",
    details: [
      { label: "Kwota", value: "100,00 PLN" },
      { label: "Numer transakcji", value: "txn_01j0demo0donation0nes" },
      { label: "Twoja wiadomość", value: "Trzymajcie kurs na rzetelne analizy." },
    ],
    ctaUrl: `${SITE_URL}/analizy`,
  },
);

export const donationReceivedEnTemplate = createAppEmailTemplate(
  "donation_received",
  "Donation receipt - EN",
  {
    lang: "en",
    firstName: "Anna",
    subjectName: "EUR 50.00",
    details: [
      { label: "Amount", value: "EUR 50.00" },
      { label: "Transaction number", value: "txn_01j0demo0donation0nes" },
      { label: "Your message", value: "Keep up the rigorous analysis." },
    ],
    ctaUrl: `${SITE_URL}/analizy`,
  },
);
