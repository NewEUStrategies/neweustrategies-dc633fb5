import * as React from "react";

import { Button, Hr, Section, Text } from "@react-email/components";

import { IconRow } from "./icons";
import {
  buttonStyle,
  greeting,
  infoBox,
  infoText,
  NesEmailLayout,
  noteBox,
  smallPrint,
  text,
  type EmailLang,
} from "./nes-layout";
import { txCopy, type TxEmailType } from "./tx-copy";
import { emailGreeting, type PolishGender } from "@/lib/i18n/polishVocative";

export interface TxDetail {
  label: string;
  value: string;
}

export interface TxEmailProps {
  type: TxEmailType;
  lang?: EmailLang;
  siteUrl: string;
  ctaUrl?: string;
  ctaLabel?: string;
  firstName?: string | null;
  gender?: PolishGender;
  vocativePl?: string | null;
  details?: TxDetail[];
  /** Dodatkowy akapit specyficzny dla zdarzenia (np. informacja o proracie). */
  extra?: string | null;
  /** Nadpisanie akapitu wstępnego treścią spersonalizowaną (`tx-body`). */
  intro?: string | null;
  /** Nadpisanie ramki "co dalej" treścią spersonalizowaną (`tx-body`). */
  note?: string | null;
}

const rowLabel: React.CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#8c8e94",
  fontWeight: 700,
  padding: "0 0 2px",
};

const rowValue: React.CSSProperties = {
  fontSize: "14px",
  color: "#141313",
  fontWeight: 700,
  padding: "0 0 12px",
};

const DetailsTable = ({ details }: { details: TxDetail[] }) => (
  <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%">
    <tbody>
      {details.map((d) => (
        <tr key={`${d.label}-${d.value}`}>
          <td>
            <div style={rowLabel}>{d.label}</div>
            <div style={rowValue}>{d.value}</div>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * Wspólny szablon maili transakcyjnych NES (subskrypcje, wydarzenia,
 * newsletter). Treść pochodzi z `tx-copy`, wygląd z `nes-layout`, więc każdy
 * typ maila jest spójny wizualnie z mailami autoryzacyjnymi.
 */
export const TxEmail = ({
  type,
  lang = "pl",
  siteUrl,
  ctaUrl,
  ctaLabel,
  firstName,
  gender = "unknown",
  vocativePl,
  details = [],
  extra,
  intro,
  note,
}: TxEmailProps) => {
  const c = txCopy(type, lang);
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
      <Text style={text}>{intro ?? c.intro}</Text>

      {details.length > 0 && (
        <Section style={infoBox}>
          <DetailsTable details={details} />
        </Section>
      )}

      {extra ? <Text style={text}>{extra}</Text> : null}

      {ctaUrl ? (
        <Section style={{ margin: "0 0 22px" }}>
          <Button style={buttonStyle} href={ctaUrl}>
            {ctaLabel ?? c.cta}
          </Button>
        </Section>
      ) : null}

      <Section style={noteBox}>
        <IconRow name="info" textStyle={infoText}>
          {note ?? c.note}
        </IconRow>
      </Section>

      <Hr style={{ borderColor: "#eceae7", margin: "18px 0 0" }} />
      <Text style={smallPrint}>{c.footerHelp}</Text>
    </NesEmailLayout>
  );
};

export default TxEmail;
