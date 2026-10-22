// RENDER MAILA ŚCIEŻKI - EmailDoc v1 węzła -> temat, HTML i tekst do kolejki.
//
// Ten sam renderer bloków co kampanie (`renderEmailHtml`) - podgląd w edytorze
// S8 i wysyłka dają ten sam układ. Różnice względem kampanii:
//   * zmienne (`variables.ts`) podstawiane w DOKUMENCIE przed renderem, z trybem
//     per pole (HTML escapowany, tekst surowy, adresy tylko zmienne serwisu) -
//     dzięki temu przycisk `{{pricing_url}}` jest bezwzględnym adresem, który
//     renderer przepuszcza;
//   * tracking 1:1 po `message_id` (`m=` w `nl-open`/`nl-click`), link podpisany
//     razem z numerem (`jm:`), bez tokenu subskrybenta;
//   * stopka wypisu tylko dla komunikacji marketingowej (usługa z podstawą
//     prawną nie ma „wypisz się z marketingu" - nie jest marketingiem),
//     adres wypisu doklejany PO przepisaniu linków (RFC 8058 nie idzie przez
//     przekierowanie trackingu).
// Plik `.server`: render widzi adres, token wiadomości i adres wypisu.
//
// Podstawianie zmiennych w dokumencie (`substituteDocVariables`) jest czystym
// kodem liścia `variables.ts` (Z-S5-08) - ten sam kod liczy podgląd edytora S8
// w przeglądarce. Re-eksport niżej zachowuje dotychczasowy import z tego pliku.
import { parseEmailDoc } from "@/lib/newsletter/emailDoc";
import { renderEmailHtml } from "@/lib/newsletter/renderEmailHtml";
import { esc } from "@/lib/newsletter/renderCampaign.server";
import { NEWSLETTER_UNSUBSCRIBE_API_PATH } from "@/lib/newsletter/unsubscribeUrl";
import {
  signJourneyLink,
  signJourneyMessageToken,
  signJourneyUnsubscribeToken,
} from "@/lib/newsletter/trackingToken.server";
import {
  substituteDocVariables,
  substituteJourneyVariables,
  type JourneyVariableValues,
} from "./variables";

export { substituteDocVariables };

export type JourneyLocale = "pl" | "en";

export interface JourneyRenderInput {
  doc: unknown;
  subject: string;
  preheader?: string | null;
  locale: JourneyLocale;
  vars: JourneyVariableValues;
  origin: string;
  /** `null` = podgląd bez trackingu (edytor, test bez wiadomości). */
  messageId: string | null;
  /** Adres wypisu RFC 8058; `null` = komunikacja usługowa (bez stopki wypisu). */
  unsubscribeUrl: string | null;
  /**
   * Piksel otwarć (`journey_settings.open_tracking_enabled`, I9c-X2).
   * `false` = mail bez piksela - najemca wyłączył pomiar otwarć; brak pola =
   * piksel jak przed X2 (domyślnie włączony). Kliknięcia i wypis bez zmian.
   */
  openTracking?: boolean;
}

export interface JourneyRenderResult {
  subject: string;
  html: string;
  text: string;
  /** Liczba linków przepisanych przez tracking kliknięć. */
  trackedLinks: number;
}

export type JourneyRenderErrorCode = "doc_invalid" | "doc_empty" | "subject_empty";

export class JourneyRenderError extends Error {
  readonly code: JourneyRenderErrorCode;

  constructor(code: JourneyRenderErrorCode) {
    super(`journey render: ${code}`);
    this.name = "JourneyRenderError";
    this.code = code;
  }
}

/** Adres przekierowania kliknięcia (podpis wiąże adres i numer linku). */
export function journeyClickUrl(
  origin: string,
  messageId: string,
  target: string,
  index: number,
): string {
  const url = new URL("/api/public/nl-click", origin);
  url.searchParams.set("m", signJourneyMessageToken(messageId));
  url.searchParams.set("i", String(index));
  url.searchParams.set("u", target);
  url.searchParams.set("k", signJourneyLink(messageId, target, index));
  return url.toString();
}

export function journeyPixelUrl(origin: string, messageId: string): string {
  const url = new URL("/api/public/nl-open", origin);
  url.searchParams.set("m", signJourneyMessageToken(messageId));
  return url.toString();
}

/** Adres wypisu ścieżki (ta sama trasa i strona co wypis z newslettera). */
export function journeyUnsubscribeUrl(origin: string, messageId: string): string {
  const url = new URL(NEWSLETTER_UNSUBSCRIBE_API_PATH, origin);
  url.searchParams.set("token", signJourneyUnsubscribeToken(messageId));
  return url.toString();
}

const HREF_RE = /href\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Wersja tekstowa (filtry antyspamowe karzą maile wyłącznie HTML). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/tr|\/h[1-6]|\/div)\s*\/?>/gi, "\n")
      .replace(/<a\s[^>]*href=(["'])([^"']+)\1[^>]*>(.*?)<\/a>/gi, "$3 ($2)")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const FOOTER: Readonly<Record<JourneyLocale, string>> = {
  pl: "Ta wiadomość trafia do Ciebie na podstawie zgody na komunikację od redakcji. Nie chcesz kolejnych?",
  en: "You receive this message because you agreed to hear from us. Prefer not to?",
};
const UNSUBSCRIBE_LABEL: Readonly<Record<JourneyLocale, string>> = {
  pl: "Wypisz się jednym kliknięciem",
  en: "Unsubscribe with one click",
};

export function renderJourneyEmail(input: JourneyRenderInput): JourneyRenderResult {
  const doc = parseEmailDoc(input.doc);
  if (!doc) throw new JourneyRenderError("doc_invalid");
  const subject = substituteJourneyVariables(input.subject, input.vars, "text").trim();
  if (!subject) throw new JourneyRenderError("subject_empty");
  const body = renderEmailHtml(substituteDocVariables(doc, input.vars), input.locale, {
    postsByBlock: {},
  });
  if (!body) throw new JourneyRenderError("doc_empty");

  let index = 0;
  const messageId = input.messageId;
  const tracked = messageId
    ? body.replace(HREF_RE, (_m, quote: string, url: string) => {
        const target = url.replace(/&amp;/gi, "&");
        const href = journeyClickUrl(input.origin, messageId, target, index).replace(/&/g, "&amp;");
        index += 1;
        return `href=${quote}${href}${quote}`;
      })
    : body;

  const preheader = input.preheader
    ? substituteJourneyVariables(input.preheader, input.vars, "text").trim()
    : "";
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div>`
    : "";
  const footer = input.unsubscribeUrl
    ? `<p style="color:#888;font-size:12px;text-align:center;margin:24px 0 0">${esc(FOOTER[input.locale])} <a href="${esc(input.unsubscribeUrl)}" style="color:#888">${esc(UNSUBSCRIBE_LABEL[input.locale])}</a>.</p>`
    : "";
  const pixel =
    messageId && input.openTracking !== false
      ? `<img src="${esc(journeyPixelUrl(input.origin, messageId))}" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`
      : "";
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto">${preheaderHtml}${tracked}${footer}${pixel}</div>`;

  const textBody = htmlToText(body);
  const text = input.unsubscribeUrl
    ? `${textBody}\n\n${FOOTER[input.locale]} ${UNSUBSCRIBE_LABEL[input.locale]}: ${input.unsubscribeUrl}`
    : textBody;

  return { subject, html, text, trackedLinks: index };
}
