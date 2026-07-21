// Czyste budowanie e-maila zaproszenia do miejsca w organizacji (B2B).
// Bez zależności od Supabase/React - w pełni unit-testowalne; warstwa wysyłki
// (selfservice.functions) tylko skleja dane i woła sendTransactionalEmail.

export interface OrgInviteEmailInput {
  orgName: string;
  invitedEmail: string;
  inviterName?: string | null;
  lang: "pl" | "en";
  /** Origin strony (np. https://neweuropeanstrategies.com) - do linku CTA. */
  origin: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

/** Minimalny escape HTML dla wartości interpolowanych do szablonu. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COPY = {
  pl: {
    subject: (org: string) => `Zaproszenie do organizacji ${org} - New European Strategies`,
    heading: "Zaproszenie do organizacji",
    intro: (org: string, inviter: string | null) =>
      inviter
        ? `${inviter} zaprasza Cię do organizacji <strong>${org}</strong> na platformie New European Strategies.`
        : `Otrzymujesz zaproszenie do organizacji <strong>${org}</strong> na platformie New European Strategies.`,
    body: "Miejsce w organizacji daje dostęp do treści i wydarzeń objętych członkostwem instytucjonalnym. Zaloguj się (lub załóż konto) na adres e-mail, na który przyszło to zaproszenie - miejsce przypisze się automatycznie.",
    cta: "Odbierz miejsce",
    hint: (email: string) =>
      `Zaproszenie jest powiązane z adresem <strong>${email}</strong>. Jeśli to nie Ty, zignoruj tę wiadomość.`,
  },
  en: {
    subject: (org: string) => `Invitation to join ${org} - New European Strategies`,
    heading: "Organisation invitation",
    intro: (org: string, inviter: string | null) =>
      inviter
        ? `${inviter} is inviting you to join <strong>${org}</strong> on the New European Strategies platform.`
        : `You have been invited to join <strong>${org}</strong> on the New European Strategies platform.`,
    body: "An organisation seat unlocks the content and events covered by the institutional membership. Sign in (or create an account) with the e-mail address this invitation was sent to - the seat is assigned automatically.",
    cta: "Claim your seat",
    hint: (email: string) =>
      `This invitation is tied to <strong>${email}</strong>. If this is not you, please ignore this message.`,
  },
} as const;

export function buildOrgInviteEmail(input: OrgInviteEmailInput): RenderedEmail {
  const copy = COPY[input.lang];
  const org = escapeHtml(input.orgName);
  const email = escapeHtml(input.invitedEmail);
  const inviter = input.inviterName ? escapeHtml(input.inviterName) : null;
  // Claim dzieje się w hubie członkostwa (claim_my_org_seats na wejściu);
  // /login z redirectem prowadzi tam zarówno nowe, jak i istniejące konta.
  const claimUrl = `${input.origin.replace(/\/+$/, "")}/profile/membership`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0F172A">
      <h1 style="color:#0F172A;font-size:22px;margin:0 0 12px">${copy.heading}</h1>
      <p>${copy.intro(org, inviter)}</p>
      <p>${copy.body}</p>
      <p style="margin:20px 0">
        <a href="${claimUrl}" style="display:inline-block;background:#0F172A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">${copy.cta}</a>
      </p>
      <p style="color:#64748B;font-size:12px;margin-top:24px">${copy.hint(email)}</p>
    </div>`;

  return { subject: copy.subject(input.orgName), html };
}
