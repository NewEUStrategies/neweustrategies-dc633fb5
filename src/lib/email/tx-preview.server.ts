// Renderowanie szablonów maili transakcyjnych (subskrypcje, wydarzenia,
// newsletter) do HTML na potrzeby podglądu w panelu admina.
// Plik server-only: React Email `render` nie może trafić do bundla klienta.
import * as React from "react";
import { render } from "@react-email/render";

import type { EmailLang } from "@/lib/email-templates/nes-layout";
import { TxEmail, type TxDetail } from "@/lib/email-templates/transactional";
import { txCopy, txSubject, type TxEmailType } from "@/lib/email-templates/tx-copy";
import type { PolishGender } from "@/lib/i18n/polishVocative";
import { txBody } from "@/lib/email-templates/tx-body";
import {
  overrideFor,
  resolvedField,
  TX_OVERRIDES_DEFAULTS,
  type TxOverrides,
} from "@/lib/email/txOverrides";
import { PROFILE_PLAN_PATH } from "@/lib/profile/routes";

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
  "payment_refunded",
  "subscription_renewal_reminder",
  "subscription_expiring",
  "team_seat_grace",
  "team_seat_grace_reminder",
  "team_seat_access_ended",
  "event_registered",
  "event_registration_received",
  "event_registration_approved",
  "event_registration_rejected",
  "event_waitlist_promoted",
  "event_ticket_paid",
  "event_ticket_refunded",
  "event_ticket_partially_refunded",
  "donation_received",
  "newsletter_confirmed",
  "customer_portal_link",
  "club_application_accepted",
  "club_application_rejected",
  "club_application_more_info",
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

/**
 * Przykladowe uzasadnienie odmowy w podgladzie maila.
 *
 * MAPA PO JEZYKU, A NIE TERNARY. Reszta danych demonstracyjnych w tym pliku
 * rozgalezia sie w kodzie (dlug zmierzony przez `check:i18n-hardcoded`);
 * nowy wpis nie ma powodu ten dlug powiekszac, a `Record<EmailLang, string>`
 * jest kanonicznym zapisem tej samej rzeczy.
 */
const DEMO_DECISION_NOTE: Record<EmailLang, string> = {
  pl: "Komplet miejsc dla tej grupy uczestników.",
  en: "The seat pool for this participant group is full.",
};

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
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
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
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "subscription_downgraded":
      return {
        subjectName: "Essential",
        details: [
          { label: l.previousPlan, value: plan },
          { label: l.newPlan, value: "Essential" },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "subscription_paused":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.endsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "subscription_resumed":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
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
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "payment_recovered":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.price, value: "249,00 PLN" },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "payment_refunded":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.price, value: "249,00 PLN" },
          { label: l.transaction, value: "txn_01hxyz9k2m4n6p8q" },
          { label: l.accessUntil, value: lang === "pl" ? "29 lipca 2026" : "29 July 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "subscription_renewal_reminder":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.price, value: "249,00 PLN" },
          { label: l.renewsAt, value: lang === "pl" ? "5 sierpnia 2026" : "5 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "subscription_expiring":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.endsAt, value: lang === "pl" ? "5 sierpnia 2026" : "5 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
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
    case "event_registration_received":
    case "event_registration_approved":
      return {
        subjectName: eventTitle,
        details: [
          { label: l.event, value: eventTitle },
          { label: l.date, value: eventDate },
          { label: l.place, value: place },
        ],
        ctaUrl: `${SITE_URL}/events`,
      };
    case "event_registration_rejected":
      return {
        subjectName: eventTitle,
        details: [
          { label: l.event, value: eventTitle },
          { label: l.date, value: eventDate },
          { label: l.decisionNote, value: DEMO_DECISION_NOTE[lang] },
        ],
        ctaUrl: `${SITE_URL}/events`,
      };
    case "event_waitlist_promoted":
      return {
        subjectName: eventTitle,
        details: [
          { label: l.event, value: eventTitle },
          { label: l.date, value: eventDate },
          { label: l.place, value: place },
          { label: l.waitlistPosition, value: "3" },
        ],
        ctaUrl: `${SITE_URL}/events`,
      };
    // Skutek platnosci za bilet: kwota w temacie, a w szczegolach zawsze
    // widac, czego dotyczy zwrot i ile faktycznie wrocilo do kupujacego.
    case "event_ticket_paid":
    case "event_ticket_refunded":
    case "event_ticket_partially_refunded":
      return {
        subjectName: eventTitle,
        details: [
          { label: l.event, value: eventTitle },
          { label: l.date, value: eventDate },
          { label: l.ticketType, value: lang === "pl" ? "Wejsciowka standard" : "Standard pass" },
          { label: l.price, value: lang === "pl" ? "450,00 PLN" : "PLN 450.00" },
          ...(type === "event_ticket_paid"
            ? []
            : [
                {
                  label: lang === "pl" ? "Kwota zwrotu" : "Refunded amount",
                  value:
                    type === "event_ticket_refunded"
                      ? lang === "pl"
                        ? "450,00 PLN"
                        : "PLN 450.00"
                      : lang === "pl"
                        ? "150,00 PLN"
                        : "PLN 150.00",
                },
              ]),
        ],
        ctaUrl: `${SITE_URL}/events`,
      };
    case "donation_received":
      return {
        subjectName: lang === "pl" ? "100,00 PLN" : "EUR 50.00",
        details: [
          { label: l.price, value: lang === "pl" ? "100,00 PLN" : "EUR 50.00" },
          { label: l.transaction, value: "txn_01j0demo0donation0nes" },
          {
            label: l.donorMessage,
            value:
              lang === "pl"
                ? "Trzymajcie kurs na rzetelne analizy."
                : "Keep up the rigorous analysis.",
          },
        ],
        ctaUrl: `${SITE_URL}/analizy`,
      };
    case "newsletter_confirmed":
      return { subjectName: null, details: [], ctaUrl: SITE_URL };
    case "club_application_accepted":
      return {
        subjectName: lang === "pl" ? "Energetyka" : "Energy",
        details: [],
        ctaUrl: `${SITE_URL}/club`,
      };
    case "club_application_rejected":
    case "club_application_more_info":
      return {
        subjectName: lang === "pl" ? "Energetyka" : "Energy",
        details: [],
        ctaUrl: `${SITE_URL}/club/apply`,
      };
    case "customer_portal_link":
      return {
        subjectName: plan,
        details: [
          { label: l.plan, value: plan },
          { label: l.renewsAt, value: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "team_seat_grace":
      return {
        subjectName: "Acme Group",
        details: [
          { label: lang === "pl" ? "Organizacja" : "Organisation", value: "Acme Group" },
          { label: l.endsAt, value: lang === "pl" ? "5 sierpnia 2026" : "5 August 2026" },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "team_seat_grace_reminder":
      return {
        subjectName: "Acme Group",
        details: [
          { label: lang === "pl" ? "Organizacja" : "Organisation", value: "Acme Group" },
          { label: l.endsAt, value: lang === "pl" ? "5 sierpnia 2026" : "5 August 2026" },
          {
            label: lang === "pl" ? "Pozostało" : "Time left",
            value: lang === "pl" ? "7 dni" : "7 days",
          },
        ],
        ctaUrl: `${SITE_URL}${PROFILE_PLAN_PATH}`,
      };
    case "team_seat_access_ended":
      return {
        subjectName: "Acme Group",
        details: [{ label: lang === "pl" ? "Organizacja" : "Organisation", value: "Acme Group" }],
        ctaUrl: `${SITE_URL}/pricing`,
      };
  }
}

/** Renderuje pojedynczy mail transakcyjny z danymi demonstracyjnymi. */
export async function renderTxEmailPreview(
  type: TxEmailType,
  lang: EmailLang,
  firstName: string | null,
  gender: PolishGender,
  overrides: TxOverrides = TX_OVERRIDES_DEFAULTS,
): Promise<TxEmailPreview> {
  const c = txCopy(type, lang);
  const demo = demoData(type, lang);
  const body = txBody(type, lang, gender, {
    planName: demo.subjectName,
    orgName: demo.subjectName,
    accessUntil: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026",
    daysLeft: 7,
  });

  const override = overrideFor(overrides, type, lang);
  const tokens = {
    planName: demo.subjectName,
    orgName: demo.subjectName,
    accessUntil: lang === "pl" ? "29 sierpnia 2026" : "29 August 2026",
    daysLeft: 7,
    subject: demo.subjectName,
    firstName,
  };
  const ov = (key: Parameters<typeof resolvedField>[1]) => resolvedField(override, key, tokens);

  const element = React.createElement(TxEmail, {
    type,
    lang,
    siteUrl: SITE_URL,
    ctaUrl: demo.ctaUrl,
    firstName,
    gender,
    details: demo.details,
    intro: ov("intro") ?? body.intro ?? null,
    extra: ov("extra") ?? body.extra ?? null,
    note: ov("note") ?? body.note ?? null,
    preview: ov("preview"),
    eyebrow: ov("eyebrow"),
    heading: ov("heading"),
    ctaLabel: ov("cta") ?? undefined,
  });

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  return {
    type,
    lang,
    subject: ov("subject") ?? txSubject(type, lang, { subject: demo.subjectName }),
    preview: ov("preview") ?? c.preview,
    html,
    text,
  };
}

/** Renderuje komplet maili transakcyjnych dla jednego języka. */
export async function renderAllTxEmailPreviews(
  lang: EmailLang,
  firstName: string | null,
  gender: PolishGender,
  overrides: TxOverrides = TX_OVERRIDES_DEFAULTS,
): Promise<TxEmailPreview[]> {
  return Promise.all(
    TX_EMAIL_TYPES.map((type) => renderTxEmailPreview(type, lang, firstName, gender, overrides)),
  );
}
