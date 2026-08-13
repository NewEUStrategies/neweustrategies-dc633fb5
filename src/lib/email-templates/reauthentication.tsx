import { Section, Text } from "@react-email/components";

import { authCopy } from "./copy";
import { IconRow } from "./icons";
import {
  codeStyle,
  greeting,
  NesEmailLayout,
  SecurityNote,
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
  const c = authCopy("reauthentication", lang, gender);
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
      <Section style={{ textAlign: "center" as const }}>
        <Text style={codeStyle}>{token}</Text>
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

export default ReauthenticationEmail;
