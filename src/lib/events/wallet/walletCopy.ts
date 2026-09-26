// Napisy przepustek Wallet (Apple i Google), PL/EN.
//
// ZWYKŁY OBIEKT, NIE i18next. Przepustkę składa trasa serwerowa, a instancja
// i18next na serwerze jest wspólna dla równoległych żądań - język jednego
// uczestnika przeciekałby do przepustki drugiego. Ten sam wzór co
// `email-templates/tx-copy.ts`: język jest PARAMETREM wywołania.
//
// Apple dostaje oba słowniki naraz (`pl.lproj` / `en.lproj/pass.strings`),
// Google - wartości w obu językach (`LocalizedString`). Klucze obu języków
// muszą być identyczne; pilnuje tego typ `WalletCopy` i test parytetu.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci. Liść.

export const WALLET_LANGS = ["pl", "en"] as const;
export type WalletLang = (typeof WALLET_LANGS)[number];

export interface WalletCopy {
  /** Opis przepustki (dostępność, ekran blokady): „Bilet: <tytuł>”. */
  readonly descriptionPrefix: string;
  readonly event: string;
  readonly date: string;
  readonly location: string;
  readonly holder: string;
  readonly ticket: string;
  readonly group: string;
  readonly code: string;
  readonly organizer: string;
  readonly eventPage: string;
  readonly info: string;
  readonly infoText: string;
}

export const WALLET_COPY: Record<WalletLang, WalletCopy> = {
  pl: {
    descriptionPrefix: "Bilet",
    event: "Wydarzenie",
    date: "Termin",
    location: "Miejsce",
    holder: "Uczestnik",
    ticket: "Rodzaj biletu",
    group: "Grupa",
    code: "Kod biletu",
    organizer: "Organizator",
    eventPage: "Strona wydarzenia",
    info: "Wejście",
    infoText:
      "Pokaż kod QR przy wejściu. Bilet jest imienny - nie udostępniaj kodu. Odwołany bilet przestaje działać przy bramce, nawet jeśli przepustka zostaje w portfelu.",
  },
  en: {
    descriptionPrefix: "Ticket",
    event: "Event",
    date: "Date",
    location: "Venue",
    holder: "Attendee",
    ticket: "Ticket type",
    group: "Group",
    code: "Ticket code",
    organizer: "Organiser",
    eventPage: "Event page",
    info: "Entry",
    infoText:
      "Show the QR code at the entrance. The ticket is personal - do not share the code. A cancelled ticket stops working at the gate even if the pass stays in your wallet.",
  },
};

/** Język przepustki z dowolnego wejścia; spoza PL/EN -> `null`. */
export function walletLang(value: unknown): WalletLang | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return lower === "pl" || lower === "en" ? lower : null;
}
