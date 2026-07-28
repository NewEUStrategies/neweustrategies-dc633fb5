import * as React from "react";

import { Section, Text } from "@react-email/components";

import { authCopy } from "./copy";
import {
  codeStyle,
  greeting,
  NesEmailLayout,
  infoText,
  noteBox,
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
  vocativePl?: string | null;
}

export const ReauthenticationEmail = ({
  siteUrl = "https://neweuropeanstrategies.com",
  token,
  lang = "pl",
  firstName,
  gender = "unknown",
  vocativePl,
}: ReauthenticationEmailProps) => {
  const c = authCopy("reauthentication", lang);
  return (
    <NesEmailLayout
      lang={lang}
      preview={c.preview}
      siteUrl={siteUrl}
      eyebrow={c.eyebrow}
      heading={c.heading}
      emoji={c.emoji}
    >
      <Text style={greeting}>{emailGreeting(lang, firstName, gender, vocativePl)}</Text>
      <Text style={text}>{c.intro}</Text>
      <Section style={{ textAlign: "center" as const }}>
        <Text style={codeStyle}>{token}</Text>
      </Section>
      <Text style={text}>⏳ {c.expiry}</Text>
      <Section style={noteBox}>
        <Text style={infoText}>🔒 {c.security}</Text>
      </Section>
      <Text style={smallPrint}>
        {lang === "pl"
          ? "Potrzebujesz pomocy? Napisz do nas - odpowiadamy w dni robocze."
          : "Need help? Write to us - we reply on business days."}
      </Text>
    </NesEmailLayout>
  );
};

export default ReauthenticationEmail;
