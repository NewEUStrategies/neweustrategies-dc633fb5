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

export type EmailLang = "pl" | "en";

export const NES_LOGO_LIGHT =
  "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/theme%2Femail%2Fnes-logo-light.png";
export const NES_LOGO_DARK =
  "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/theme%2Femail%2Fnes-logo-dark.png";

const NAVY = "#01112F";
const ORANGE = "#FA9346";
const INK = "#141313";
const MUTED = "#55575d";
const SAND = "#F8F6F4";
const BORDER = "#eceae7";
const FONT = '"Red Hat Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

interface LayoutProps {
  lang: EmailLang;
  preview: string;
  siteUrl: string;
  children: React.ReactNode;
}

const FOOTER_COPY = {
  pl: {
    tagline: "Analizy, dane i doradztwo strategiczne dla Europy.",
    auto: "Ta wiadomość została wysłana automatycznie - prosimy na nią nie odpowiadać.",
    site: "neweuropeanstrategies.com",
    privacy: "Polityka prywatności",
    contact: "Kontakt",
  },
  en: {
    tagline: "Analysis, data and strategic advisory for Europe.",
    auto: "This message was sent automatically - please do not reply to it.",
    site: "neweuropeanstrategies.com",
    privacy: "Privacy policy",
    contact: "Contact",
  },
} as const;

/**
 * Wspólna ramka maili systemowych NES: jasny header z poziomym logo,
 * biała karta treści i ciemna (granatowa) stopka z logo w wersji dark.
 */
export const NesEmailLayout = ({ lang, preview, siteUrl, children }: LayoutProps) => {
  const f = FOOTER_COPY[lang];
  return (
    <Html lang={lang} dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={outer}>
          <Section style={header}>
            <Link href={siteUrl}>
              <Img
                src={NES_LOGO_LIGHT}
                alt="New European Strategies"
                width={196}
                height={81}
                style={logoImg}
              />
            </Link>
          </Section>

          <Section style={card}>{children}</Section>

          <Section style={footer}>
            <Img
              src={NES_LOGO_DARK}
              alt="New European Strategies"
              width={168}
              height={69}
              style={logoImg}
            />
            <Text style={footerTagline}>{f.tagline}</Text>
            <Hr style={footerRule} />
            <Text style={footerLinks}>
              <Link href={siteUrl} style={footerLink}>
                {f.site}
              </Link>
              {"  ·  "}
              <Link href={`${siteUrl}/polityka-prywatnosci`} style={footerLink}>
                {f.privacy}
              </Link>
              {"  ·  "}
              <Link href={`${siteUrl}/kontakt`} style={footerLink}>
                {f.contact}
              </Link>
            </Text>
            <Text style={footerNote}>{f.auto}</Text>
            <Text style={footerNote}>
              © {new Date().getFullYear()} New European Strategies
            </Text>
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

const header: React.CSSProperties = {
  backgroundColor: SAND,
  borderRadius: "6px 6px 0 0",
  padding: "24px 28px",
  textAlign: "center" as const,
};

const logoImg: React.CSSProperties = {
  display: "block",
  margin: "0 auto",
  border: 0,
};

const card: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: `1px solid ${BORDER}`,
  borderTop: `3px solid ${ORANGE}`,
  padding: "32px 28px",
};

const footer: React.CSSProperties = {
  backgroundColor: NAVY,
  borderRadius: "0 0 6px 6px",
  padding: "28px",
  textAlign: "center" as const,
};

const footerTagline: React.CSSProperties = {
  color: "#c7cedb",
  fontSize: "12px",
  lineHeight: "1.6",
  margin: "12px 0 0",
};

const footerRule: React.CSSProperties = {
  borderColor: "rgba(255,255,255,0.14)",
  margin: "18px 0",
};

const footerLinks: React.CSSProperties = {
  color: "#8d97a8",
  fontSize: "12px",
  margin: "0 0 12px",
};

const footerLink: React.CSSProperties = {
  color: ORANGE,
  textDecoration: "none",
};

const footerNote: React.CSSProperties = {
  color: "#7b8598",
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
  color: NAVY,
  lineHeight: "1.25",
  margin: "0 0 8px",
};

export const greeting: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: INK,
  margin: "18px 0 10px",
};

export const text: React.CSSProperties = {
  fontSize: "13px",
  color: MUTED,
  lineHeight: "1.65",
  margin: "0 0 16px",
};

export const buttonStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  borderRadius: "6px",
  padding: "13px 24px",
  textDecoration: "none",
  display: "inline-block",
};

export const linkStyle: React.CSSProperties = {
  color: NAVY,
  textDecoration: "underline",
  wordBreak: "break-all" as const,
};

export const infoBox: React.CSSProperties = {
  backgroundColor: SAND,
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  padding: "14px 16px",
  margin: "0 0 18px",
};

export const infoText: React.CSSProperties = {
  fontSize: "12px",
  color: MUTED,
  lineHeight: "1.6",
  margin: 0,
};

export const codeStyle: React.CSSProperties = {
  backgroundColor: SAND,
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  color: NAVY,
  display: "inline-block",
  fontFamily: '"Courier New", Courier, monospace',
  fontSize: "28px",
  fontWeight: 700,
  letterSpacing: "0.28em",
  padding: "14px 22px",
  margin: "0 0 20px",
};

export const smallPrint: React.CSSProperties = {
  fontSize: "11px",
  color: "#8c8e94",
  lineHeight: "1.6",
  margin: "22px 0 0",
};
