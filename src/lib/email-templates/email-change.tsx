import { Button, Section, Text } from "@react-email/components";

import { authCopy, EMAIL_CHANGE_LABELS } from "./copy";
import { IconRow } from "./icons";
import {
  buttonStyle,
  greeting,
  infoBox,
  infoText,
  linkStyle,
  NesEmailLayout,
  SecurityNote,
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
  const c = authCopy("email_change", lang, gender);
  const labels = EMAIL_CHANGE_LABELS[lang];
  return (
    <NesEmailLayout
      lang={lang}
      preview={c.preview}
      siteUrl={siteUrl}
      eyebrow={c.eyebrow}
      heading={c.heading}
      icon={c.icon}
    >
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
      <IconRow name="clock" textStyle={text}>
        {c.expiry}
      </IconRow>
      <SecurityNote lang={lang}>{c.security}</SecurityNote>
      <Text style={smallPrint}>
        {lang === "pl"
          ? "Potrzebujesz pomocy? Napisz do nas - odpowiadamy w dni robocze."
          : "Need help? Write to us - we reply on business days."}
      </Text>
    </NesEmailLayout>
  );
};

export default EmailChangeEmail;
