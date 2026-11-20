// Czysty builder natychmiastowego e-maila sygnału (@wzmianka, prośba o zdanie).
// Bez Supabase i env - unit-testowalny. Wysyłka: dyspozytor kanałów przez tę
// samą kolejkę co digest (`enqueueRawEmail`, etykieta `notification_signal`).
//
// Styl jak w digestach: inline CSS, jedna kolumna, białe tło, akcent marki
// #FA9346 na przycisku z ciemnym tekstem (kontrast AA).
import type { SignalEvent, SignalLang } from "./signals";

export const SIGNAL_EMAIL_LABEL = "notification_signal";
const SITE_NAME = "New European Strategies";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nagłówek Subject bez znaków nowej linii (wstrzyknięcie nagłówków). */
export function signalEmailSubject(event: Pick<SignalEvent, "title">): string {
  const title = event.title.replace(/[\r\n]+/g, " ").trim();
  return `${title} - ${SITE_NAME}`;
}

const COPY: Readonly<
  Record<
    SignalLang,
    { greeting: (name: string) => string; cta: string; why: string; manage: string }
  >
> = {
  pl: {
    greeting: (name) => `Cześć ${name},`,
    cta: "Otwórz dyskusję",
    why: "Dostajesz tę wiadomość, bo włączono natychmiastowe e-maile o wzmiankach i prośbach o zdanie.",
    manage: "Zmień ustawienia powiadomień",
  },
  en: {
    greeting: (name) => `Hi ${name},`,
    cta: "Open the discussion",
    why: "You are receiving this because instant emails about mentions and requests for your view are on.",
    manage: "Change notification settings",
  },
};

export function buildSignalEmailText(opts: {
  event: SignalEvent;
  displayName: string | null;
  settingsUrl: string;
}): string {
  const copy = COPY[opts.event.lang];
  const lines = [
    opts.displayName ? copy.greeting(opts.displayName) : null,
    opts.event.title,
    opts.event.body || null,
    `${copy.cta}: ${opts.event.url}`,
    "",
    copy.why,
    `${copy.manage}: ${opts.settingsUrl}`,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

export function buildSignalEmailHtml(opts: {
  event: SignalEvent;
  displayName: string | null;
  settingsUrl: string;
}): string {
  const { event, displayName, settingsUrl } = opts;
  const copy = COPY[event.lang];
  const greeting = displayName
    ? `<tr><td style="font-size:14px;color:#44403C;padding-bottom:8px">${esc(copy.greeting(displayName))}</td></tr>`
    : "";
  const body = event.body
    ? `<tr><td style="font-size:15px;line-height:1.55;color:#292524;padding-top:8px">${esc(event.body)}</td></tr>`
    : "";

  return `<!doctype html><html lang="${event.lang}"><body style="margin:0;padding:0;background:#ffffff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #E7E5E4;border-radius:6px;padding:28px 32px;font-family:'Red Hat Display',Arial,Helvetica,sans-serif">
        <tr><td style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#78716C;padding-bottom:14px">${SITE_NAME}</td></tr>
        ${greeting}
        <tr><td style="font-size:19px;line-height:1.35;font-weight:700;color:#1C1917">${esc(event.title)}</td></tr>
        ${body}
        <tr><td style="padding-top:22px">
          <a href="${esc(event.url)}" style="display:inline-block;background:#FA9346;color:#1C1917;font-weight:700;font-size:14px;text-decoration:none;padding:11px 20px;border-radius:6px">${esc(copy.cta)}</a>
        </td></tr>
        <tr><td style="padding-top:26px;font-size:12px;line-height:1.5;color:#78716C">
          ${esc(copy.why)}<br>
          <a href="${esc(settingsUrl)}" style="color:#78716C">${esc(copy.manage)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
