import * as React from "react";

import { Img } from "@react-email/components";

/**
 * Ikony Lucide w mailach systemowych NES.
 *
 * Klienty pocztowe (Gmail, Outlook) usuwają inline `<svg>`, dlatego ikony
 * Lucide są prerenderowane do PNG (3x, kolory marki) i serwowane ze storage.
 * Dzięki temu zamiast emoji mamy spójny, wektorowo wygenerowany zestaw ikon.
 */
const ICON_BASE =
  "https://unnltowbgszpdzwpawdu.supabase.co/storage/v1/object/public/media/theme%2Femail%2Ficons";

export type EmailIconName =
  | "hero-check"
  | "hero-handshake"
  | "hero-magic"
  | "hero-key"
  | "hero-mail"
  | "hero-shield"
  | "clock"
  | "lock"
  | "info";

/** Ikona Lucide (lucide-react) wyrenderowana do PNG - patrz opis modułu. */
export const iconUrl = (name: EmailIconName): string => `${ICON_BASE}/${name}.png`;

interface EmailIconProps {
  name: EmailIconName;
  size?: number;
  alt?: string;
  style?: React.CSSProperties;
}

export const EmailIcon = ({ name, size = 16, alt = "", style }: EmailIconProps) => (
  <Img
    src={iconUrl(name)}
    alt={alt}
    width={size}
    height={size}
    style={{ display: "block", border: 0, ...style }}
  />
);

interface IconRowProps {
  name: EmailIconName;
  size?: number;
  textStyle: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Wiersz "ikona + tekst" oparty o tabelę - jedyny układ, który trzyma się
 * poprawnie w Outlooku i Gmailu (flex/gap nie są tam wspierane).
 */
export const IconRow = ({ name, size = 16, textStyle, children }: IconRowProps) => (
  <table
    role="presentation"
    cellPadding={0}
    cellSpacing={0}
    border={0}
    style={{ borderCollapse: "collapse", margin: textStyle.margin ?? 0 }}
  >
    <tbody>
      <tr>
        <td valign="top" style={{ paddingRight: "8px", paddingTop: "2px", width: `${size}px` }}>
          <EmailIcon name={name} size={size} />
        </td>
        <td valign="top" style={{ ...textStyle, margin: 0 }}>
          {children}
        </td>
      </tr>
    </tbody>
  </table>
);
