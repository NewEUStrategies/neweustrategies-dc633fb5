import * as React from "react";

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import { EmailIcon, type EmailIconName } from "./icons";
import { NES_CONTACT, NES_SOCIAL_LINKS } from "./social";

export type EmailLang = "pl" | "en";

export const NES_LOGO_LIGHT =
  "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/theme%2Femail%2Fnes-logo-light.png";
export const NES_LOGO_DARK =
  "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/theme%2Femail%2Fnes-logo-dark.png";

/** Ciemna baza marki w mailach (zamiast granatu). */
const INK = "#141313";
const INK_SOFT = "#221f1e";
const ORANGE = "#FA9346";
const AMBER = "#F8B632";
const MUTED = "#55575d";
const SAND = "#F8F6F4";
const BORDER = "#eceae7";
const FONT = '"Red Hat Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

interface LayoutProps {
  lang: EmailLang;
  preview: string;
  siteUrl: string;
  /** Nagłówek hero (ciemny pas) */
  eyebrow?: string;
  heading?: string;
  icon?: EmailIconName;
  children: React.ReactNode;
}

const FOOTER_COPY = {
  pl: {
    tagline: "Analizy, dane i doradztwo strategiczne dla Europy.",
    auto: "Ta wiadomość została wysłana automatycznie - prosimy na nią nie odpowiadać.",
    site: "neweuropeanstrategies.com",
    privacy: "Polityka prywatności",
    contact: "Kontakt",
    claim: "WIEDZA · STRATEGIA · WPŁYW",
  },
  en: {
    tagline: "Analysis, data and strategic advisory for Europe.",
    auto: "This message was sent automatically - please do not reply to it.",
    site: "neweuropeanstrategies.com",
    privacy: "Privacy policy",
    contact: "Contact",
    claim: "KNOWLEDGE · STRATEGY · IMPACT",
  },
} as const;

/**
 * Wspólna ramka maili systemowych NES: jasny header z poziomym logo,
 * ciemny hero (#141313) z logo w wariancie dark, tytułem i ikoną Lucide pod nim, biała karta treści
 * oraz ciemna stopka z logo w wersji dark.
 */
export const NesEmailLayout = ({
  lang,
  preview,
  siteUrl,
  eyebrow: eyebrowText,
  heading,
  icon,
  children,
}: LayoutProps) => {
  const f = FOOTER_COPY[lang];
  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={outer}>
          {/* Hero renderujemy zawsze - to on niesie logo marki (wariant dark). */}
          <Section style={hero}>
            <Section style={heroLogoWrap}>
              <Link href={siteUrl}>
                <Img
                  src={NES_LOGO_DARK}
                  alt="New European Strategies"
                  width={168}
                  height={70}
                  style={logoImg}
                />
              </Link>
            </Section>
            {eyebrowText ? <Text style={heroEyebrow}>{eyebrowText}</Text> : null}
            {heading ? <Text style={heroTitle}>{heading}</Text> : null}
            {icon ? (
              <Section style={heroIconWrap}>
                <EmailIcon name={icon} size={30} style={{ margin: "0 auto" }} />
              </Section>
            ) : null}
          </Section>

          <Section style={card}>{children}</Section>

          <Section style={footer}>
            <Img
              src={NES_LOGO_DARK}
              alt="New European Strategies"
              width={150}
              height={62}
              style={logoImg}
            />
            <Text style={footerClaim}>{f.claim}</Text>
            <Text style={footerTagline}>{f.tagline}</Text>

            {/* Social media - tabela zamiast flexa (Outlook/Gmail). */}
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              border={0}
              align="center"
              style={socialTable}
            >
              <tbody>
                <tr>
                  {NES_SOCIAL_LINKS.map((s) => (
                    <td key={s.key} style={socialCell}>
                      <Link href={s.href} style={socialLink} title={s.label}>
                        <EmailIcon name={s.icon} size={16} alt={s.label} />
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            <Hr style={footerRule} />

            <Text style={footerLinks}>
              <Link href={siteUrl} style={footerLink}>
                {f.site}
              </Link>
              <span style={footerSep}>·</span>
              <Link href={`${siteUrl}/polityka-prywatnosci`} style={footerLink}>
                {f.privacy}
              </Link>
              <span style={footerSep}>·</span>
              <Link href={`${siteUrl}/kontakt`} style={footerLink}>
                {f.contact}
              </Link>
            </Text>

            <Text style={footerContact}>
              <Link href={`mailto:${NES_CONTACT.email}`} style={footerContactLink}>
                {NES_CONTACT.email}
              </Link>
              <span style={footerSep}>·</span>
              {NES_CONTACT.phone}
            </Text>
            <Text style={footerAddress}>
              {lang === "pl" ? NES_CONTACT.addressPl : NES_CONTACT.addressEn}
            </Text>

            <Text style={footerNote}>{f.auto}</Text>
            <Text style={footerNote}>© {new Date().getFullYear()} New European Strategies</Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
};

/* --- współdzielone style (inline, bez zewnętrznego CSS) --- */

export const main: React.CSSProperties = {
  backgroundColor: "#ffffff",
  fontFamily: FONT,
  margin: 0,
  padding: "24px 0",
};

const outer: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  width: "100%",
};

const logoImg: React.CSSProperties = {
  display: "block",
  margin: "0 auto",
  border: 0,
};

const hero: React.CSSProperties = {
  backgroundColor: INK,
  backgroundImage: `linear-gradient(140deg, ${INK} 0%, ${INK_SOFT} 62%, #2c211a 100%)`,
  borderBottom: `3px solid ${ORANGE}`,
  borderRadius: "10px 10px 0 0",
  padding: "30px 28px 28px",
  textAlign: "center" as const,
};

const heroLogoWrap: React.CSSProperties = {
  margin: "0 0 16px",
  textAlign: "center" as const,
};

/** Ikona Lucide siedzi POD tytulem hero (logo przejelo miejsce nad nim). */
const heroIconWrap: React.CSSProperties = {
  margin: "16px 0 0",
  textAlign: "center" as const,
};

const heroEyebrow: React.CSSProperties = {
  color: AMBER,
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  margin: "0 0 8px",
};

const heroTitle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "25px",
  fontWeight: 700,
  lineHeight: "1.25",
  margin: 0,
};

const card: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: `1px solid ${BORDER}`,
  borderTop: "none",
  padding: "30px 28px 32px",
};

const footer: React.CSSProperties = {
  backgroundColor: INK,
  backgroundImage: `linear-gradient(180deg, ${INK_SOFT} 0%, ${INK} 100%)`,
  borderTop: `1px solid rgba(250,147,70,0.35)`,
  borderRadius: "0 0 10px 10px",
  padding: "30px 28px 26px",
  textAlign: "center" as const,
};

const footerClaim: React.CSSProperties = {
  color: ORANGE,
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.18em",
  margin: "12px 0 0",
};

const footerTagline: React.CSSProperties = {
  color: "#cfc9c5",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: "8px 0 0",
};

/* --- pasek social media --- */

const socialTable: React.CSSProperties = {
  borderCollapse: "separate" as const,
  margin: "18px auto 0",
};

const socialCell: React.CSSProperties = {
  padding: "0 5px",
};

/** Kwadratowa "płytka" z białym glifem - czytelna na ciemnym tle. */
const socialLink: React.CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "8px",
  display: "inline-block",
  lineHeight: "0",
  padding: "9px",
  textDecoration: "none",
};

const footerRule: React.CSSProperties = {
  borderColor: "rgba(255,255,255,0.12)",
  margin: "20px 0 16px",
};

const footerLinks: React.CSSProperties = {
  color: "#9b9490",
  fontSize: "12px",
  fontWeight: 600,
  margin: "0 0 10px",
};

const footerLink: React.CSSProperties = {
  color: ORANGE,
  textDecoration: "none",
};

const footerSep: React.CSSProperties = {
  color: "rgba(255,255,255,0.25)",
  padding: "0 8px",
};

const footerContact: React.CSSProperties = {
  color: "#cfc9c5",
  fontSize: "12px",
  lineHeight: "1.7",
  margin: "0 0 2px",
};

const footerContactLink: React.CSSProperties = {
  color: "#cfc9c5",
  textDecoration: "none",
};

const footerAddress: React.CSSProperties = {
  color: "#8b8481",
  fontSize: "11px",
  lineHeight: "1.6",
  margin: "0 0 14px",
};

const footerNote: React.CSSProperties = {
  color: "#8b8481",
  fontSize: "11px",
  lineHeight: "1.6",
  margin: "4px 0 0",
};


export const eyebrow: React.CSSProperties = {
  color: ORANGE,
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  margin: "0 0 10px",
};

export const h1: React.CSSProperties = {
  fontSize: "23px",
  fontWeight: 700,
  color: INK,
  lineHeight: "1.25",
  margin: "0 0 8px",
};

export const greeting: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: INK,
  margin: "0 0 10px",
};

export const text: React.CSSProperties = {
  fontSize: "13px",
  color: MUTED,
  lineHeight: "1.7",
  margin: "0 0 16px",
};

export const buttonStyle: React.CSSProperties = {
  backgroundColor: ORANGE,
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  borderRadius: "8px",
  padding: "14px 26px",
  textDecoration: "none",
  display: "inline-block",
};


export const linkStyle: React.CSSProperties = {
  color: INK,
  textDecoration: "underline",
  wordBreak: "break-all" as const,
};

export const infoBox: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderTop: `1px solid ${BORDER}`,
  borderBottom: `1px solid ${BORDER}`,
  borderRadius: 0,
  padding: "14px 0",
  margin: "0 0 18px",
};

export const infoText: React.CSSProperties = {
  fontSize: "12px",
  color: MUTED,
  lineHeight: "1.7",
  margin: 0,
};

/** Blok bezpieczenstwa - powsciagliwy, bez kolorowych alertow. */
export const noteBox: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderTop: `1px solid ${BORDER}`,
  borderRadius: 0,
  padding: "14px 0 0",
  margin: "20px 0 0",
};

export const noteLabel: React.CSSProperties = {
  color: INK,
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  margin: "0 0 6px",
};

export const codeStyle: React.CSSProperties = {
  backgroundColor: SAND,
  border: `1px solid ${BORDER}`,
  borderRadius: "8px",
  color: INK,
  display: "inline-block",
  fontFamily: '"Courier New", Courier, monospace',
  fontSize: "30px",
  fontWeight: 700,
  letterSpacing: "0.28em",
  padding: "16px 24px",
  margin: "0 0 20px",
};

export const smallPrint: React.CSSProperties = {
  fontSize: "11px",
  color: "#8c8e94",
  lineHeight: "1.6",
  margin: "22px 0 0",
};

/**
 * Nota bezpieczenstwa - stonowana typografia zamiast kolorowego "alert boxa".
 * Cienka linia u gory, wersalikowa etykieta, tekst w kolorze tresci.
 */
export const SecurityNote = ({
  lang,
  children,
  label,
}: {
  lang: EmailLang;
  children: React.ReactNode;
  label?: string;
}) => (
  <Section style={noteBox}>
    <Text style={noteLabel}>{label ?? (lang === "pl" ? "Bezpieczeństwo" : "Security")}</Text>
    <Text style={infoText}>{children}</Text>
  </Section>
);
