// Szablon prośby o potwierdzenie subskrypcji (wygaszanie, I9d-Y1) - ramka
// maili systemowych NES (`NesEmailLayout`): ten sam nagłówek, karta i stopka
// co potwierdzenie zapisu do newslettera, więc odbiorca rozpozna nadawcę.
//
// TYLKO IMPORT DYNAMICZNY (`newsletterSunsetRender.server.ts`): moduł ciągnie
// `@react-email/components`, a ten nie może trafić do grafu żadnego żądania,
// które maila nie renderuje (precedens F04 w `transactional.server.ts`).
import * as React from "react";

import { Button, Hr, Link, Section, Text } from "@react-email/components";

import { IconRow } from "@/lib/email-templates/icons";
import {
  buttonStyle,
  greeting,
  infoText,
  linkStyle,
  NesEmailLayout,
  noteBox,
  smallPrint,
  text,
} from "@/lib/email-templates/nes-layout";
import { emailGreeting } from "@/lib/i18n/polishVocative";
import {
  NEWSLETTER_SUNSET_FIXED_COPY,
  type NewsletterSunsetCopy,
  type NewsletterSunsetLang,
} from "./newsletterSunset";

export interface NewsletterSunsetEmailProps {
  lang: NewsletterSunsetLang;
  siteUrl: string;
  /** Treść po nadpisaniach z panelu i podstawieniu zmiennych. */
  copy: NewsletterSunsetCopy;
  firstName: string | null;
  keepUrl: string;
  /** `null` = brak tokenu wypisu (podgląd bez subskrybenta) - bez linku wypisu. */
  unsubscribeUrl: string | null;
}

/** Akapity wstępu: pusta linia w polu z panelu = nowy akapit. */
function paragraphs(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export const NewsletterSunsetEmail = ({
  lang,
  siteUrl,
  copy,
  firstName,
  keepUrl,
  unsubscribeUrl,
}: NewsletterSunsetEmailProps) => {
  const fixed = NEWSLETTER_SUNSET_FIXED_COPY[lang];
  return (
    <NesEmailLayout
      lang={lang}
      preview={copy.preview}
      siteUrl={siteUrl}
      eyebrow={copy.eyebrow}
      heading={copy.heading}
      icon="hero-mail"
    >
      <Text style={greeting}>{emailGreeting(lang, firstName)}</Text>
      {paragraphs(copy.intro).map((part) => (
        <Text key={part} style={text}>
          {part}
        </Text>
      ))}

      <Section style={{ margin: "0 0 22px" }}>
        <Button style={buttonStyle} href={keepUrl}>
          {copy.cta}
        </Button>
      </Section>

      <Section style={noteBox}>
        <IconRow name="info" textStyle={infoText}>
          {copy.note}
        </IconRow>
      </Section>

      {unsubscribeUrl ? (
        <>
          <Hr style={{ borderColor: "#eceae7", margin: "18px 0 0" }} />
          <Text style={smallPrint}>
            {fixed.unsubscribeLead}{" "}
            <Link href={unsubscribeUrl} style={linkStyle}>
              {fixed.unsubscribeLink}
            </Link>
          </Text>
        </>
      ) : null}
    </NesEmailLayout>
  );
};

export default NewsletterSunsetEmail;
