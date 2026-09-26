// Składanie treści maili NABORU PRELEGENTÓW: potwierdzenie wysłania zgłoszenia
// i trzy decyzje organizatora (przyjęcie, odmowa, prośba o zmiany).
//
// CZYSTY RACHUNEK, OSOBNO OD DEKLARACJI SERVER FUNCTION (wymóg tss-serverfn-split):
// ładunek z bazy plus język odbiorcy dają wiersze szczegółów i adres przycisku.
// Test nie potrzebuje atrapy poczty ani bazy.
//
// JĘZYK = `notify_lang` ZGŁOSZENIA, nie interfejsu organizatora. Organizator
// klika „wyślij" w polskim panelu, a prelegent zgłaszał się po angielsku - mail
// ma przyjść po angielsku.
//
// PRZYCISK PROWADZI TAM, GDZIE JEST NASTĘPNY KROK. Po wysłaniu i po przyjęciu -
// do panelu prelegenta (stan, potwierdzenie udziału); po prośbie o zmiany - do
// formularza tego zgłoszenia; po odmowie - na stronę wydarzenia (nie do panelu,
// w którym nie ma już nic do zrobienia).
//
// INFORMACJA ZWROTNA IDZIE DO MAILA TYLKO Z `feedback_to_speaker`. Notatka
// wewnętrzna organizatora i komentarze recenzentów nie wychodzą poza panel.
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { txCopy, type TxEmailType } from "@/lib/email-templates/tx-copy";
import { formatEventMoment } from "@/lib/events/registrationNotify.server";

/** Momenty, o których piszemy do prelegenta. */
export const CFP_MAIL_NOTICES = ["received", "accepted", "rejected", "changes_requested"] as const;
export type CfpMailNotice = (typeof CFP_MAIL_NOTICES)[number];

const TYPE_BY_NOTICE: Readonly<Record<CfpMailNotice, TxEmailType>> = {
  received: "event_cfp_submission_received",
  accepted: "event_cfp_submission_accepted",
  rejected: "event_cfp_submission_rejected",
  changes_requested: "event_cfp_submission_changes_requested",
};

export function cfpNoticeType(notice: CfpMailNotice): TxEmailType {
  return TYPE_BY_NOTICE[notice];
}

export interface CfpNoticeContent {
  type: TxEmailType;
  lang: EmailLang;
  eventTitle: string;
  firstName: string | null;
  tenantId: string | null;
  details: TxDetail[];
  ctaPath: string;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pair(lang: EmailLang, pl: unknown, en: unknown): string {
  const plText = text(pl);
  const enText = text(en);
  return (lang === "en" ? (enText ?? plText) : (plText ?? enText)) ?? "";
}

/** Ładunek RPC (`admin_event_cfp_notify_payload` / `event_cfp_submission_notice`) -> treść maila. */
export function buildCfpNotice(
  notice: CfpMailNotice,
  row: Record<string, unknown>,
): CfpNoticeContent {
  const lang: EmailLang = row.lang === "en" ? "en" : "pl";
  const labels = txCopy(TYPE_BY_NOTICE[notice], lang).labels;
  const eventTitle = pair(lang, row.event_title_pl, row.event_title_en);
  const talk = pair(lang, row.title_pl, row.title_en);
  const slug = text(row.event_slug);
  const submissionId = text(row.submission_id);
  const timezone = text(row.event_timezone);

  const details: TxDetail[] = [];
  if (eventTitle !== "") details.push({ label: labels.event, value: eventTitle });
  if (talk !== "") details.push({ label: labels.talk, value: talk });

  if (notice === "received" || notice === "accepted") {
    // Przy przyjęciu z planem prelegent dostaje godzinę SESJI, nie otwarcia wydarzenia.
    const sessionStart = notice === "accepted" ? text(row.session_starts_at) : null;
    const when = formatEventMoment(sessionStart ?? text(row.event_starts_at), timezone, lang);
    if (when !== "") details.push({ label: labels.date, value: when });
  }
  if (notice !== "received") {
    const feedback = text(row.feedback_to_speaker);
    if (feedback !== null) details.push({ label: labels.organizerMessage, value: feedback });
  }

  const eventPath = slug === null ? "/events" : `/events/${slug}`;
  const panelPath = slug === null ? "/events" : `/events/${slug}/speaker`;
  const ctaPath =
    notice === "rejected"
      ? eventPath
      : notice === "changes_requested" && slug !== null && submissionId !== null
        ? `/events/${slug}/cfp-submit?id=${encodeURIComponent(submissionId)}`
        : panelPath;

  return {
    type: TYPE_BY_NOTICE[notice],
    lang,
    eventTitle,
    firstName: text(row.first_name),
    tenantId: text(row.tenant_id),
    details,
    ctaPath,
  };
}
