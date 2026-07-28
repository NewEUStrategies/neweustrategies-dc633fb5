import * as React from "react";

import { Section, Text } from "@react-email/components";

import { authCopy } from "./copy";
import {
  codeStyle,
  eyebrow,
  greeting,
  h1,
  NesEmailLayout,
  smallPrint,
  text,
  type EmailLang,
} from "./nes-layout";
import { emailGreeting, type PolishGender } from "@/lib/i18n/polishVocative";

interface ReauthenticationEmailProps {
  siteName?: string;
  siteUrl?: string;
  token: string;
  lang?: EmailLang;
  firstName?: string | null;
  gender?: PolishGender;
}

export const ReauthenticationEmail = ({
  siteUrl = "https://neweuropeanstrategies.com",
  token,
  lang = "pl",
  firstName,
  gender = "unknown",
}: ReauthenticationEmailProps) => {
  const c = authCopy("reauthentication", lang);
  return (
    <NesEmailLayout lang={lang} preview={c.preview} siteUrl={siteUrl}>
      <Text style={eyebrow}>{c.eyebrow}</Text>
      <Text style={h1}>{c.heading}</Text>
      <Text style={greeting}>{emailGreeting(lang, firstName, gender)}</Text>
      <Text style={text}>{c.intro}</Text>
      <Section style={{ textAlign: "center" as const }}>
        <Text style={codeStyle}>{token}</Text>
      </Section>
      <Text style={text}>{c.expiry}</Text>
      <Text style={smallPrint}>{c.security}</Text>
    </NesEmailLayout>
  );
};

export default ReauthenticationEmail;
