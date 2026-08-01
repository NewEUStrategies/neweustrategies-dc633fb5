// Renderowanie szablonów maili autoryzacyjnych do HTML na potrzeby podglądu
// w panelu admina (/admin/newsletter/email-preview).
// Plik server-only: React Email `render` nie może trafić do bundla klienta.
import * as React from "react";
import { render } from "@react-email/render";

import { authCopy, type AuthEmailType } from "@/lib/email-templates/copy";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";
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

function componentFor(type: AuthEmailType): React.ComponentType<PreviewProps> {
  switch (type) {
    case "signup":
      return SignupEmail as React.ComponentType<PreviewProps>;
    case "invite":
      return InviteEmail as React.ComponentType<PreviewProps>;
    case "magiclink":
      return MagicLinkEmail as React.ComponentType<PreviewProps>;
    case "recovery":
      return RecoveryEmail as React.ComponentType<PreviewProps>;
    case "email_change":
      return EmailChangeEmail as React.ComponentType<PreviewProps>;
    case "reauthentication":
      return ReauthenticationEmail as React.ComponentType<PreviewProps>;
  }
}

/** Renderuje pojedynczy szablon z danymi demonstracyjnymi. */
export async function renderAuthEmailPreview(
  input: AuthEmailPreviewInput,
): Promise<AuthEmailPreview> {
  const copy = authCopy(input.type, input.lang, input.gender);
  const Component = componentFor(input.type);

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
