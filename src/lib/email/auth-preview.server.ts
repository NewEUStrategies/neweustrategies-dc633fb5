// Renderowanie szablonów maili autoryzacyjnych do HTML na potrzeby podglądu
// w panelu admina (/admin/newsletter/email-preview).
// Plik server-only: React Email `render` nie może trafić do bundla klienta.
//
// F04 (2026-09-20): `@react-email/render` i sześć szablonów ciągnących
// `@react-email/components` były importowane STATYCZNIE, a ten moduł ma
// kilkunastu importerów w grafie serwera (funkcje serwerowe podglądu, panel).
// Rollup hoistuje moduł współdzielony do wspólnego przodka, więc cały
// React Email był EWALUOWANY PRZY STARCIE IZOLATU Workera - także dla żądań,
// które nigdy nie renderują maila. Krawędzie schodzą do `await import(...)`
// WEWNĄTRZ funkcji renderującej: kontrakt eksportów bez zmian (obie funkcje
// i tak były `async`), a graf startowy izolatu bez React Email.
import * as React from "react";

import { authCopy, type AuthEmailType } from "@/lib/email-templates/copy";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { PolishGender } from "@/lib/i18n/polishVocative";

export const AUTH_EMAIL_TYPES: readonly AuthEmailType[] = [
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
  "reauthentication",
] as const;

export interface AuthEmailPreviewInput {
  type: AuthEmailType;
  lang: EmailLang;
  firstName: string | null;
  gender: PolishGender;
}

export interface AuthEmailPreview {
  type: AuthEmailType;
  lang: EmailLang;
  subject: string;
  preview: string;
  html: string;
  text: string;
}

const SITE_URL = "https://neweuropeanstrategies.com";
const DEMO_URL = `${SITE_URL}/auth/confirm?token=demo-token-preview-only`;

type PreviewProps = {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
  token: string;
  oldEmail: string;
  newEmail: string;
  lang: EmailLang;
  firstName: string | null;
  gender: PolishGender;
};

/**
 * Szablon ładowany DOPIERO przy renderowaniu - i tylko ten jeden, którego
 * dotyczy żądanie. `switch` ze statycznymi specyfikatorami (a nie `import()`
 * z wyliczaną ścieżką) zostawia Rollupowi sześć jawnych, analizowalnych
 * krawędzi, więc podział na chunki jest deterministyczny.
 */
async function componentFor(type: AuthEmailType): Promise<React.ComponentType<PreviewProps>> {
  switch (type) {
    case "signup":
      return (await import("@/lib/email-templates/signup"))
        .SignupEmail as React.ComponentType<PreviewProps>;
    case "invite":
      return (await import("@/lib/email-templates/invite"))
        .InviteEmail as React.ComponentType<PreviewProps>;
    case "magiclink":
      return (await import("@/lib/email-templates/magic-link"))
        .MagicLinkEmail as React.ComponentType<PreviewProps>;
    case "recovery":
      return (await import("@/lib/email-templates/recovery"))
        .RecoveryEmail as React.ComponentType<PreviewProps>;
    case "email_change":
      return (await import("@/lib/email-templates/email-change"))
        .EmailChangeEmail as React.ComponentType<PreviewProps>;
    case "reauthentication":
      return (await import("@/lib/email-templates/reauthentication"))
        .ReauthenticationEmail as React.ComponentType<PreviewProps>;
  }
}

/** Renderuje pojedynczy szablon z danymi demonstracyjnymi. */
export async function renderAuthEmailPreview(
  input: AuthEmailPreviewInput,
): Promise<AuthEmailPreview> {
  const copy = authCopy(input.type, input.lang, input.gender);
  const [{ render }, Component] = await Promise.all([
    import("@react-email/render"),
    componentFor(input.type),
  ]);

  const props: PreviewProps = {
    siteName: "New European Strategies",
    siteUrl: SITE_URL,
    recipient: "podglad@neweuropeanstrategies.com",
    confirmationUrl: DEMO_URL,
    token: "482 915",
    oldEmail: "stary.adres@example.com",
    newEmail: "nowy.adres@example.com",
    lang: input.lang,
    firstName: input.firstName,
    gender: input.gender,
  };

  const element = React.createElement(Component, props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  return {
    type: input.type,
    lang: input.lang,
    subject: copy.subject,
    preview: copy.preview,
    html,
    text,
  };
}

/** Renderuje komplet szablonów dla jednego języka (widok listy w panelu). */
export async function renderAllAuthEmailPreviews(
  lang: EmailLang,
  firstName: string | null,
  gender: PolishGender,
): Promise<AuthEmailPreview[]> {
  return Promise.all(
    AUTH_EMAIL_TYPES.map((type) => renderAuthEmailPreview({ type, lang, firstName, gender })),
  );
}
