// Szablon prośby o zgodę na pomiar otwarć i kliknięć (I9d-Y2) - ramka maili
// systemowych NES (`NesEmailLayout`), ta sama co prośba wygaszania Y1
// i potwierdzenie zapisu, więc odbiorca rozpozna nadawcę.
//
// Mail pokazuje DOSŁOWNĄ treść zgody, którą zapisze kliknięcie (bieżąca
// treść domyślna z jednego źródła `@/lib/newsletter/consentText`, w języku
// subskrybenta) - osoba wie, na co się zgadza, zanim kliknie (art. 7 ust. 2
// RODO: prośba wyraźnie odróżniona, zrozumiała). Sam mail NIE ma piksela ani
// linków z identyfikatorem - prosimy o zgodę na pomiar, więc nie mierzymy.
//
// TYLKO IMPORT DYNAMICZNY (`measurementReconfirmRender.server.ts`): moduł
// ciągnie `@react-email/components`, który nie może trafić do grafu żadnego
// żądania, które maila nie renderuje.
import { Button, Hr, Link, Section, Text } from "@react-email/components";

import { IconRow } from "@/lib/email-templates/icons";
import {
  buttonStyle,
  greeting,
  infoBox,
  infoText,
  linkStyle,
  NesEmailLayout,
  noteBox,
  noteLabel,
  smallPrint,
  text,
} from "@/lib/email-templates/nes-layout";
import { emailGreeting } from "@/lib/i18n/polishVocative";
import { newsletterConsentPlain } from "@/lib/newsletter/consentText";
import {
  NEWSLETTER_MEASUREMENT_FIXED_COPY,
  type NewsletterMeasurementCopy,
  type NewsletterMeasurementLang,
} from "./measurementReconfirm";

export interface MeasurementReconfirmEmailProps {
  lang: NewsletterMeasurementLang;
  siteUrl: string;
  /** Treść po nadpisaniach z panelu i podstawieniu zmiennych. */
  copy: NewsletterMeasurementCopy;
  firstName: string | null;
  confirmUrl: string;
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

export const MeasurementReconfirmEmail = ({
  lang,
  siteUrl,
  copy,
  firstName,
  confirmUrl,
  unsubscribeUrl,
}: MeasurementReconfirmEmailProps) => {
  const fixed = NEWSLETTER_MEASUREMENT_FIXED_COPY[lang];
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

      <Section style={infoBox}>
        <Text style={noteLabel}>{fixed.consentLead}</Text>
        <Text style={infoText}>{newsletterConsentPlain(lang)}</Text>
      </Section>

      <Section style={{ margin: "0 0 22px" }}>
        <Button style={buttonStyle} href={confirmUrl}>
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

export default MeasurementReconfirmEmail;
