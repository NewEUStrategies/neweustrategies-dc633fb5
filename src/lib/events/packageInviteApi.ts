// Przyjecie zaproszenia na miejsce z pakietu: `event_package_invite_accept`.
//
// TOKEN JEST POSWIADCZENIEM, NIE IDENTYFIKATOREM. Baza trzyma wylacznie jego
// SHA-256 i przyjmuje go od kazdego, kto go zna - traktujemy go jak haslo:
// nie wklada sie go do cache zapytan, nie loguje i nie doklejamy do adresow
// innych niz strona przyjecia zaproszenia.
//
// KSZTALT SPRAWDZAMY U SIEBIE. Baza wystawia DWA ksztalty tokenu: zaproszenie
// organizatora idzie przez `_event_new_qr_token()` (24 bajty w base64url, 32
// znaki), a zaproszenie kupujacego przez `event_package_seat_invite()` (dwa
// UUID bez myslnikow, 64 znaki szesnastkowe). Oba mieszcza sie w alfabecie
// `[A-Za-z0-9_-]`, wiec sprawdzamy alfabet i zakres dlugosci - adres z
// literowka odpada od razu, bez zuzywania proby limitu w bazie.
//
// JEDNORAZOWOSC. Udane wywolanie kasuje skrot tokenu, wiec `manage_token`
// i `qr_token` wracaja RAZ - komponent musi je pokazac, a nie schowac.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** 32 znaki (base64url organizatora) albo 64 znaki (token kupujacego). */
export const PACKAGE_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isPackageInviteToken(value: string): boolean {
  return PACKAGE_INVITE_TOKEN_PATTERN.test(value.trim());
}

/** Wejscie z adresu -> token albo `null`, gdy ksztalt sie nie zgadza. */
export function readPackageInviteToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isPackageInviteToken(trimmed) ? trimmed : null;
}

export interface PackageInviteAcceptInput {
  token: string;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  companyText?: string | null;
  consentDataProcessing: boolean;
}

export interface PackageInviteAcceptResult {
  registrationId: string;
  eventId: string | null;
  status: string;
  /** Kod wejscia - pokazywany raz, zaraz po przyjeciu zaproszenia. */
  qrToken: string | null;
  /** Jedyny klucz samoobslugi zgloszenia dla delegata bez konta. */
  manageToken: string | null;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function text(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function acceptPackageInvite(
  input: PackageInviteAcceptInput,
): Promise<PackageInviteAcceptResult> {
  const payload: Record<string, Json> = {
    token: input.token,
    first_name: input.firstName,
    last_name: input.lastName,
    consent_data_processing: input.consentDataProcessing,
  };
  // `undefined` nie jedzie do RPC: brak klucza znaczy „nie dotykaj", a jawny
  // `null` znaczylby „wyczysc" juz zapisane dane osoby.
  if (input.jobTitle !== undefined && input.jobTitle !== null && input.jobTitle !== "") {
    payload.job_title = input.jobTitle;
  }
  if (
    input.companyText !== undefined &&
    input.companyText !== null &&
    input.companyText !== ""
  ) {
    payload.company_text = input.companyText;
  }

  const { data, error } = await supabase.rpc("event_package_invite_accept", {
    p_payload: payload,
  });
  if (error) throw error;

  const source = bag(data);
  const registrationId = source === null ? null : text(source, "registration_id");
  if (source === null || registrationId === null) {
    // Miejsce moglo zostac przypisane, ale bez identyfikatora nie umiemy go
    // pokazac ani odwolac - mowimy o tym wprost, zamiast rysowac pusty sukces.
    throw new Error("unknown: invitation response is not readable");
  }

  return {
    registrationId,
    eventId: text(source, "event_id"),
    status: text(source, "status") ?? "approved",
    qrToken: text(source, "qr_token"),
    manageToken: text(source, "manage_token"),
  };
}
