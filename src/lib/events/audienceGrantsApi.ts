// UPRAWNIENIA DO STAWEK (stawka akademicka, NGO, firmowa).
//
// Stawka zawezona do grupy odbiorcow nie jest deklaracja kupujacego, tylko
// decyzja organizatora: ktos podal podstawe (legitymacja, KRS, domena uczelni),
// a panel te podstawe zapisuje razem z nadaniem. Dlatego `evidence` jest polem
// obowiazkowym po stronie bazy - nadanie bez uzasadnienia nie ma wartosci
// rozliczeniowej.
//
// NADANIE NIE JEST KASOWANE. Wycofanie stempluje `revoked_at`, bo wiersz
// tlumaczy, dlaczego ktos zaplacil mniej - to slad audytowy, nie ustawienie.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventAudienceGrantRow = Fns["admin_event_audience_grants_list"]["Returns"][number];

/** Grupy, dla ktorych baza w ogole przyjmuje nadanie - CHECK `..._audience_values`. */
export const AUDIENCE_GRANT_AUDIENCES = ["academic", "ngo", "company"] as const;
export type AudienceGrantAudience = (typeof AUDIENCE_GRANT_AUDIENCES)[number];

/** Stany wyliczane przez `admin_event_audience_grants_list`. */
export const AUDIENCE_GRANT_STATES = ["active", "scheduled", "expired", "revoked"] as const;
export type AudienceGrantState = (typeof AUDIENCE_GRANT_STATES)[number];

export function audienceGrantState(row: EventAudienceGrantRow): AudienceGrantState {
  const state = row.state;
  return AUDIENCE_GRANT_STATES.find((value) => value === state) ?? "active";
}

export interface AudienceGrantsQuery {
  /** `null` = nadania niezwiazane z jednym wydarzeniem tez wchodza do listy. */
  eventId: string | null;
  audience: AudienceGrantAudience | "all";
  includeRevoked: boolean;
  search: string;
}

function payload(input: Record<string, Json | undefined>): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export async function fetchAudienceGrants(
  query: AudienceGrantsQuery,
): Promise<EventAudienceGrantRow[]> {
  const search = query.search.trim();
  const { data, error } = await supabase.rpc("admin_event_audience_grants_list", {
    p_payload: payload({
      event_id: query.eventId ?? undefined,
      audience: query.audience === "all" ? undefined : query.audience,
      include_revoked: query.includeRevoked,
      search: search === "" ? undefined : search,
    }),
  });
  if (error) throw error;
  return data ?? [];
}

export interface AudienceGrantInput {
  audience: AudienceGrantAudience;
  /** Dokladnie jedno z dwoch - baza odrzuca oba naraz i oba puste. */
  userId: string | null;
  personId: string | null;
  companyId: string | null;
  /** `null` = nadanie obowiazuje we wszystkich wydarzeniach najemcy. */
  eventId: string | null;
  evidence: string;
  validUntil: string | null;
}

export async function saveAudienceGrant(input: AudienceGrantInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_audience_grant_save", {
    p_payload: payload({
      audience: input.audience,
      user_id: input.userId,
      person_id: input.personId,
      company_id: input.companyId,
      event_id: input.eventId,
      evidence: input.evidence.trim(),
      valid_until: input.validUntil,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function revokeAudienceGrant(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_audience_grant_revoke", { p_id: id });
  if (error) throw error;
  return true;
}

// ----------------------------------------------------------------------------
// HISTORIA ZMIAN. Lista nadan mowi o STANIE; audyt rozliczen pyta o DROGE:
// kto przedluzyl waznosc, kto podmienil podstawe, kto wycofal i kiedy. Zrodlem
// jest wspolny dziennik `public.audit_log` (wpis stawia trigger bazy), a nie
// druga ksiega w kodzie - inaczej historia rozjechalaby sie ze stanem.
// ----------------------------------------------------------------------------
export type EventAudienceGrantHistoryRow =
  Fns["admin_event_audience_grant_history"]["Returns"][number];

/** Akcje, ktore stawia trigger `event_audience_grants_audit`. */
export const AUDIENCE_GRANT_ACTIONS = ["granted", "updated", "revoked", "restored"] as const;
export type AudienceGrantAction = (typeof AUDIENCE_GRANT_ACTIONS)[number];

/** `event_audience_grant.revoked` -> `revoked`; nieznane akcje -> `updated`. */
export function audienceGrantAction(action: string): AudienceGrantAction {
  const tail = action.split(".").pop() ?? "";
  return AUDIENCE_GRANT_ACTIONS.find((value) => value === tail) ?? "updated";
}

/** Pola diffu, ktore ekran umie nazwac po ludzku - reszta ladnie degraduje. */
export const AUDIENCE_GRANT_HISTORY_FIELDS = [
  "audience",
  "evidence",
  "valid_from",
  "valid_until",
  "revoked_at",
  "company_id",
  "event_id",
  "user_id",
  "person_id",
] as const;

export interface AudienceGrantHistoryQuery {
  /** `null` = historia calego najemcy, nie jednego wydarzenia. */
  eventId: string | null;
  /** `null` = wszystkie nadania; UUID = sciezka jednego uprawnienia. */
  grantId: string | null;
  search: string;
  limit: number;
}

export function historyValueText(value: Json | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export async function fetchAudienceGrantHistory(
  query: AudienceGrantHistoryQuery,
): Promise<EventAudienceGrantHistoryRow[]> {
  const search = query.search.trim();
  const { data, error } = await supabase.rpc("admin_event_audience_grant_history", {
    p_payload: payload({
      event_id: query.eventId ?? undefined,
      grant_id: query.grantId ?? undefined,
      search: search === "" ? undefined : search,
      limit: query.limit,
    }),
  });
  if (error) throw error;
  return data ?? [];
}
