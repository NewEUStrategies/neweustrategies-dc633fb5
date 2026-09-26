// Przepustka Apple Wallet (`.pkpass`) z modelu biletu.
//
// PACZKA: `pass.json` (typ `eventTicket`), ikony, `pl.lproj`/`en.lproj`
// `pass.strings`, `manifest.json` (SHA-1 każdego pliku) i `signature`
// (odłączony podpis CMS manifestu certyfikatem Pass Type ID + WWDR), całość
// w ZIP. Wallet odrzuca paczkę, w której choć jeden plik nie zgadza się
// z manifestem albo manifest z podpisem - stąd jeden konstruktor, który
// liczy skróty z TYCH SAMYCH bajtów, które pakuje.
//
// JĘZYK. Wartości w `pass.json` są w języku, w którym uczestnik kliknął
// „Dodaj”. `pass.strings` mapuje każdy z tych napisów na drugi język, więc
// telefon z angielskim interfejsem pokaże przepustkę po angielsku, a telefon
// w języku spoza PL/EN - w języku kliknięcia. Klucze to napisy, nie
// identyfikatory: brak dopasowania nigdy nie pokaże gołego klucza.
// Plik `.strings` jest w UTF-16LE z BOM - format opisany przez Apple.
//
// KOD QR to SAM jawny kod biletu (jak na stronie biletu), więc skaner czyta
// przepustkę tak samo jak ekran telefonu. Przepustka jest statyczna (bez
// `webServiceURL`/APNs): anulowany bilet odrzuca bramka, nie portfel.
// `expirationDate` (koniec + 1 dzień) wyszarza ją po wydarzeniu.
//
// Moduł serwerowy: podpis używa klucza prywatnego z konfiguracji.
import { parseHex } from "@/lib/charts/palette";

import { signDetachedCms } from "./cms";
import { sha1Hex } from "./rsa";
import type { AppleWalletConfig } from "./walletConfig.server";
import { WALLET_COPY, WALLET_LANGS, type WalletCopy, type WalletLang } from "./walletCopy";
import { walletIconFiles } from "./walletIcons";
import { eventPageUrl, type WalletTicket } from "./walletTicket";
import { zipStore, type ZipEntry } from "./zip";

interface PassField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `#RRGGBB` -> `rgb(r, g, b)` - jedyny zapis koloru, który przyjmuje `pass.json`. */
export function passColor(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Znacznik W3C bez milisekund (`2026-10-01T07:00:00Z`) - Wallet nie czyta ułamków. */
export function passDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function field(key: string, label: string, value: string | null): PassField[] {
  return value === null ? [] : [{ key, label, value }];
}

/** Pola przepustki w jednym języku (te same klucze w obu). */
function passFields(ticket: WalletTicket, lang: WalletLang, publicOrigin: string | null) {
  const copy: WalletCopy = WALLET_COPY[lang];
  return {
    description: `${copy.descriptionPrefix}: ${ticket.event.title[lang]}`,
    primaryFields: field("event", copy.event, ticket.event.title[lang]),
    secondaryFields: [
      ...field("date", copy.date, ticket.event.when[lang]),
      ...field("location", copy.location, ticket.event.location),
    ],
    auxiliaryFields: [
      ...field("holder", copy.holder, ticket.holderName),
      ...field("ticket", copy.ticket, ticket.ticketName?.[lang] ?? null),
      ...field("group", copy.group, ticket.groupName?.[lang] ?? null),
    ],
    backFields: [
      ...field("code", copy.code, ticket.qrToken),
      ...field("info", copy.info, copy.infoText),
      ...field("organizer", copy.organizer, ticket.organizationName),
      ...field("event_page", copy.eventPage, eventPageUrl(publicOrigin, ticket.event.slug)),
    ],
  };
}

type Fields = ReturnType<typeof passFields>;

function allTexts(fields: Fields): string[] {
  const texts = [fields.description];
  for (const group of [
    fields.primaryFields,
    fields.secondaryFields,
    fields.auxiliaryFields,
    fields.backFields,
  ]) {
    for (const entry of group) texts.push(entry.label, entry.value);
  }
  return texts;
}

/** `pass.json` przepustki (typ `eventTicket`). */
export function buildPassJson(
  ticket: WalletTicket,
  config: AppleWalletConfig,
  publicOrigin: string | null,
): Record<string, unknown> {
  const fields = passFields(ticket, ticket.lang, publicOrigin);
  const start = new Date(ticket.event.startsAt);
  const end = ticket.event.endsAt === null ? start : new Date(ticket.event.endsAt);
  const barcode = {
    format: "PKBarcodeFormatQR",
    message: ticket.qrToken,
    messageEncoding: "iso-8859-1",
    altText: ticket.qrToken,
  };
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    teamIdentifier: config.teamId,
    serialNumber: ticket.registrationId,
    organizationName: ticket.organizationName,
    description: fields.description,
    logoText: ticket.organizationName,
    backgroundColor: passColor(ticket.colors.background),
    foregroundColor: passColor(ticket.colors.foreground),
    labelColor: passColor(ticket.colors.label),
    // Bilet jest imienny - iOS nie proponuje wysłania przepustki dalej
    // (AirDrop, Wiadomości). Kod i tak jest poświadczeniem jednej osoby.
    sharingProhibited: true,
    relevantDate: passDate(start),
    expirationDate: passDate(new Date(end.getTime() + DAY_MS)),
    barcodes: [barcode],
    eventTicket: {
      primaryFields: fields.primaryFields,
      secondaryFields: fields.secondaryFields,
      auxiliaryFields: fields.auxiliaryFields,
      backFields: fields.backFields,
    },
  };
}

function escapeStrings(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

/**
 * Treść `<target>.lproj/pass.strings`: napis z `pass.json` (język kliknięcia)
 * -> ten sam napis w języku `target`. Pierwsze wystąpienie klucza wygrywa.
 */
export function passStrings(
  ticket: WalletTicket,
  target: WalletLang,
  publicOrigin: string | null,
): string {
  const source = allTexts(passFields(ticket, ticket.lang, publicOrigin));
  const translated = allTexts(passFields(ticket, target, publicOrigin));
  const seen = new Set<string>();
  const lines: string[] = [];
  source.forEach((key, index) => {
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`"${escapeStrings(key)}" = "${escapeStrings(translated[index])}";`);
  });
  return `${lines.join("\n")}\n`;
}

/** UTF-16LE z BOM (FF FE). */
export function utf16le(value: string): Uint8Array {
  const out = new Uint8Array(2 + value.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >>> 8;
  }
  return out;
}

export interface ApplePassInput {
  readonly ticket: WalletTicket;
  readonly config: AppleWalletConfig;
  /** `https://<host najemcy>` albo `null`, gdy hosta nie da się ustalić. */
  readonly publicOrigin: string | null;
  /** Chwila wydania (atrybut `signingTime` podpisu). */
  readonly now: Date;
}

/** Gotowa paczka `.pkpass`. */
export async function buildApplePass(input: ApplePassInput): Promise<Uint8Array> {
  const { ticket, config, publicOrigin } = input;
  const encoder = new TextEncoder();
  const files: ZipEntry[] = [
    {
      name: "pass.json",
      data: encoder.encode(JSON.stringify(buildPassJson(ticket, config, publicOrigin))),
    },
    ...walletIconFiles(),
    ...WALLET_LANGS.map((lang) => ({
      name: `${lang}.lproj/pass.strings`,
      data: utf16le(passStrings(ticket, lang, publicOrigin)),
    })),
  ];

  const manifest: Record<string, string> = {};
  for (const file of files) manifest[file.name] = await sha1Hex(file.data);
  const manifestBytes = encoder.encode(JSON.stringify(manifest));

  const signature = await signDetachedCms({
    content: manifestBytes,
    signerCertPem: config.signerCertPem,
    signerKeyPem: config.signerKeyPem,
    chainPems: [config.wwdrCertPem],
    signingTime: input.now,
  });

  return zipStore([
    ...files,
    { name: "manifest.json", data: manifestBytes },
    { name: "signature", data: signature },
  ]);
}
