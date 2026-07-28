import * as React from "react";

import { Button, Section, Text } from "@react-email/components";

import { authCopy } from "./copy";
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

interface SignupEmailProps {
  siteName?: string;
  siteUrl: string;
  recipient?: string;
  confirmationUrl: string;
  lang?: EmailLang;
  firstName?: string | null;
  gender?: PolishGender;
  vocativePl?: string | null;
}

export const SignupEmail = ({
  siteUrl,
  confirmationUrl,
  lang = "pl",
  firstName,
  gender = "unknown",
  vocativePl,
}: SignupEmailProps) => {
  const c = authCopy("signup", lang);
  return (
    <NesEmailLayout lang={lang} preview={c.preview} siteUrl={siteUrl}>
      <Text style={eyebrow}>{c.eyebrow}</Text>
      <Text style={h1}>{c.heading}</Text>
      <Text style={greeting}>{emailGreeting(lang, firstName, gender, vocativePl)}</Text>
      <Text style={text}>{c.intro}</Text>
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

export default SignupEmail;
