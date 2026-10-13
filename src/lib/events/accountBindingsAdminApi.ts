// Dowiazania kont do kartotek uczestnikow - ekran organizatora (REG-01, D14;
// migracja 20261012120100).
//
// KONTO WIAZE SIE Z KARTOTEKA TYLKO PRZEZ POTWIERDZONY ADRES. Naprawa historii
// (20261012190000) odwiazala kazde dowiazanie, ktore tej reguly nie spelnialo,
// i zapisala je w dzienniku. Ten modul czyta liste dowiazan niespelniajacych
// reguly (po naprawie zwykle pusta) i dziennik, a organizator moze odwiazac
// konto albo PRZYWROCIC dowiazanie - jawny, logowany wyjatek od reguly.
//
// NAJEMCA Z SESJI, NIE Z LADUNKU. Wszystkie trzy RPC biora organizacje
// z `assert_event_admin_tenant()` (admin albo super_admin) - ladunek niesie
// wylacznie identyfikator osoby albo wpisu dziennika.
//
// ADRES KONTA ZAMASKOWANY. Konto nie nalezy do kartoteki organizacji
// (`auth.users` jest wspolne), wiec baza oddaje tylko `j***@domena`.
import { supabase } from "@/integrations/supabase/client";

export const ACCOUNT_BINDING_RISKS = [
  "foreign_record",
  "no_email",
  "account_unconfirmed",
  "self_created",
  "verified",
] as const;
export type AccountBindingRisk = (typeof ACCOUNT_BINDING_RISKS)[number];

export const ACCOUNT_UNBIND_REASONS = ["reg01_remediation", "admin_unbind"] as const;
export type AccountUnbindReason = (typeof ACCOUNT_UNBIND_REASONS)[number];

/** Dowiazanie bez potwierdzonego adresu kartoteki (audyt najemcy). */
export interface UnverifiedAccountBinding {
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  accountEmailHint: string | null;
  accountEmailConfirmed: boolean;
  risk: AccountBindingRisk;
  registrationsByAccount: number;
}

/** Wpis dziennika odwiazan. */
export interface AccountUnbindEntry {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  accountEmailHint: string | null;
  risk: AccountBindingRisk;
  reason: AccountUnbindReason;
  registrationsByAccount: number;
  unboundAt: string;
  restoredAt: string | null;
  /** Konto z wpisu usuniete - przywrocic nie ma czego. */
  accountDeleted: boolean;
  /** Kartoteka ma juz (inne albo to samo) konto. */
  personBound: boolean;
}

export interface AccountBindingsOverview {
  unverified: UnverifiedAccountBinding[];
  unbinds: AccountUnbindEntry[];
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

function count(source: Bag, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function riskOf(source: Bag): AccountBindingRisk {
  const raw = text(source, "risk");
  return (ACCOUNT_BINDING_RISKS as readonly string[]).includes(raw ?? "")
    ? (raw as AccountBindingRisk)
    : "self_created";
}

function reasonOf(source: Bag): AccountUnbindReason {
  return text(source, "reason") === "reg01_remediation" ? "reg01_remediation" : "admin_unbind";
}

function rows(value: unknown): Bag[] {
  return Array.isArray(value) ? value.map(bag).filter((row): row is Bag => row !== null) : [];
}

export function parseAccountBindings(data: unknown): AccountBindingsOverview {
  const source = bag(data);
  const unverified: UnverifiedAccountBinding[] = [];
  for (const row of rows(source?.unverified)) {
    const personId = text(row, "person_id");
    if (personId === null) continue;
    unverified.push({
      personId,
      firstName: text(row, "first_name") ?? "",
      lastName: text(row, "last_name") ?? "",
      email: text(row, "email"),
      accountEmailHint: text(row, "account_email_hint"),
      accountEmailConfirmed: row.account_email_confirmed === true,
      risk: riskOf(row),
      registrationsByAccount: count(row, "registrations_by_account"),
    });
  }
  const unbinds: AccountUnbindEntry[] = [];
  for (const row of rows(source?.unbinds)) {
    const id = text(row, "id");
    const personId = text(row, "person_id");
    const unboundAt = text(row, "unbound_at");
    if (id === null || personId === null || unboundAt === null) continue;
    unbinds.push({
      id,
      personId,
      firstName: text(row, "first_name") ?? "",
      lastName: text(row, "last_name") ?? "",
      email: text(row, "email"),
      accountEmailHint: text(row, "account_email_hint"),
      risk: riskOf(row),
      reason: reasonOf(row),
      registrationsByAccount: count(row, "registrations_by_account"),
      unboundAt,
      restoredAt: text(row, "restored_at"),
      accountDeleted: row.account_deleted === true,
      personBound: row.person_bound === true,
    });
  }
  return { unverified, unbinds };
}

export async function fetchAccountBindings(): Promise<AccountBindingsOverview> {
  const { data, error } = await supabase.rpc("admin_event_people_account_bindings", {
    p_payload: {},
  });
  if (error) throw error;
  return parseAccountBindings(data);
}

/** Odwiazuje konto od kartoteki - wpis `admin_unbind` w dzienniku. */
export async function unbindPersonAccount(personId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("admin_event_person_account_unbind", {
    p_payload: { person_id: personId },
  });
  if (error) throw error;
  const source = bag(data);
  return source === null ? null : text(source, "unbind_id");
}

/** Przywraca dowiazanie z dziennika - jawny, logowany atest organizatora. */
export async function restorePersonAccount(unbindId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_event_person_account_restore", {
    p_payload: { unbind_id: unbindId },
  });
  if (error) throw error;
}
