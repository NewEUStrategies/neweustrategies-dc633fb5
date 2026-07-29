// Renderowanie szablonów maili transakcyjnych (subskrypcje, wydarzenia,
// newsletter) do HTML na potrzeby podglądu w panelu admina.
// Plik server-only: React Email `render` nie może trafić do bundla klienta.
import * as React from "react";
import { render } from "@react-email/render";

import type { EmailLang } from "@/lib/email-templates/nes-layout";
import { TxEmail, type TxDetail } from "@/lib/email-templates/transactional";
import { txCopy, txSubject, type TxEmailType } from "@/lib/email-templates/tx-copy";
import type { PolishGender } from "@/lib/i18n/polishVocative";

export const TX_EMAIL_TYPES: readonly TxEmailType[] = [
  "subscription_confirmed",
  "subscription_renewed",
  "subscription_canceled",
  "subscription_upgraded",
  "subscription_downgraded",
  "subscription_paused",
  "subscription_resumed",
  "payment_failed",
  "payment_recovered",
  "subscription_renewal_reminder",
  "subscription_expiring",
  "event_registered",
  "newsletter_confirmed",
] as const;

export interface TxEmailPreview {
  type: TxEmailType;
  lang: EmailLang;
  subject: string;
  preview: string;
  html: string;
  text: string;
}

const SITE_URL = "https://neweuropeanstrategies.com";

interface DemoData {
  subjectName: string | null;
  details: TxDetail[];
  ctaUrl: string;
}

function demoData(type: TxEmailType, lang: EmailLang): DemoData {
  const c = txCopy(type, lang);
  const l = c.labels;
  const plan = "Professional";
  const eventTitle =
    lang === "pl" ? "Europejski Briefing Strategiczny" : "European Strategic Briefing";
  const eventDate = lang === "pl" ? "29 lipca 2026, 18:00" : "29 July 2026, 18:00";
  const place = lang === "pl" ? "Warszawa / online" : "Warsaw / online";

  switch (type) {
    case "subscription_confirmed":
    case "subscription_renewed":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.price, value: "249,00 PLN" },
          { label: l.period, value: lang === "pl" ? "miesięczny" : "monthly" },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "subscription_canceled":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.endsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/pricing`,
      };
    case "subscription_upgraded":
      return {
        subjectName: "Executive",
        details: [
          { label: l.previousPlan, value: plan },
          { label: l.newPlan, value: "Executive" },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "subscription_downgraded":
      return {
        subjectName: "Essential",
        details: [
          { label: l.previousPlan, value: plan },
          { label: l.newPlan, value: "Essential" },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "subscription_paused":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.endsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "subscription_resumed":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "payment_failed":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.price, value: "249,00 PLN" },
          { label: l.attemptedAt, value: lang === "pl" ? "29 lipca 2026" : "29 July 2026" },
          { label: l.retryAt, value: lang === "pl" ? "1 sierpnia 2026" : "1 August 2026" },
          { label: l.accessUntil, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "payment_recovered":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.price, value: "249,00 PLN" },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "subscription_renewal_reminder":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.price, value: "249,00 PLN" },
          { label: l.renewsAt, value: lang === "pl" ? "5 sierpnia 2026" : "5 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "subscription_expiring":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.endsAt, value: lang === "pl" ? "5 sierpnia 2026" : "5 August 2026" },
        ],
        ctaUrl: `${SITE_URL}/profile/subscription`,
      };
    case "event_registered":

      return {
        subjectName: eventTitle,
        details: [
          { label: l.event, value: eventTitle },
          { label: l.date, value: eventDate },
          { label: l.place, value: place },
        ],
        ctaUrl: `${SITE_URL}/events`,
      };
    case "newsletter_confirmed":
      return { subjectName: null, details: [], ctaUrl: SITE_URL };
  }
}

/** Renderuje pojedynczy mail transakcyjny z danymi demonstracyjnymi. */
export async function renderTxEmailPreview(
  type: TxEmailType,
  lang: EmailLang,
  firstName: string | null,
  gender: PolishGender,
): Promise<TxEmailPreview> {
  const c = txCopy(type, lang);
  const demo = demoData(type, lang);

  const element = React.createElement(TxEmail, {
    type,
    lang,
    siteUrl: SITE_URL,
    ctaUrl: demo.ctaUrl,
    firstName,
    gender,
    details: demo.details,
  });

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return {
    type,
    lang,
    subject: txSubject(type, lang, { subject: demo.subjectName }),
    preview: c.preview,
    html,
    text,
  };
}

/** Renderuje komplet maili transakcyjnych dla jednego języka. */
export async function renderAllTxEmailPreviews(
  lang: EmailLang,
  firstName: string | null,
  gender: PolishGender,
): Promise<TxEmailPreview[]> {
  return Promise.all(
    TX_EMAIL_TYPES.map((type) => renderTxEmailPreview(type, lang, firstName, gender)),
  );
}
