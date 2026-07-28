import * as React from "react";

import { Button, Section, Text } from "@react-email/components";

import { authCopy, EMAIL_CHANGE_LABELS } from "./copy";
import {
  buttonStyle,
  eyebrow,
  greeting,
  h1,
  infoBox,
  infoText,
  linkStyle,
  NesEmailLayout,
  smallPrint,
  text,
  type EmailLang,
} from "./nes-layout";
import { emailGreeting, type PolishGender } from "@/lib/i18n/polishVocative";

interface EmailChangeEmailProps {
  siteName?: string;
  siteUrl?: string;
  confirmationUrl: string;
  oldEmail?: string;
  newEmail?: string;
  lang?: EmailLang;
  firstName?: string | null;
  gender?: PolishGender;
  vocativePl?: string | null;
}

export const EmailChangeEmail = ({
  siteUrl = "https://neweuropeanstrategies.com",
  confirmationUrl,
  oldEmail,
  newEmail,
  lang = "pl",
  firstName,
  gender = "unknown",
  vocativePl,
}: EmailChangeEmailProps) => {
  const c = authCopy("email_change", lang);
  const labels = EMAIL_CHANGE_LABELS[lang];
  return (
    <NesEmailLayout lang={lang} preview={c.preview} siteUrl={siteUrl}>
      <Text style={eyebrow}>{c.eyebrow}</Text>
      <Text style={h1}>{c.heading}</Text>
      <Text style={greeting}>{emailGreeting(lang, firstName, gender, vocativePl)}</Text>
      <Text style={text}>{c.intro}</Text>
      {(oldEmail || newEmail) && (
        <Section style={infoBox}>
          {oldEmail && (
            <Text style={infoText}>
              {labels.from}: <strong>{oldEmail}</strong>
            </Text>
          )}
          {newEmail && (
            <Text style={infoText}>
              {labels.to}: <strong>{newEmail}</strong>
            </Text>
          )}
        </Section>
      )}
      <Section style={{ margin: "0 0 24px" }}>
        <Button style={buttonStyle} href={confirmationUrl}>
          {c.cta}
        </Button>
      </Section>
      <Section style={infoBox}>
        <Text style={infoText}>
          {c.fallback}
          <br />
          <a href={confirmationUrl} style={linkStyle}>
            {confirmationUrl}
          </a>
        </Text>
      </Section>
      <Text style={text}>{c.expiry}</Text>
      <Text style={smallPrint}>{c.security}</Text>
    </NesEmailLayout>
  );
};

export default EmailChangeEmail;
