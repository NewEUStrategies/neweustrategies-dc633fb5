// Synchronizacja członków z CRM - osoby (crm_leads) i firmy (crm_companies).
//
// PRZYCZYNA ŹRÓDŁOWA. Członkostwo i CRM opisują tę samą osobę w dwóch
// tabelach. Dopóki ręczne nadanie planu nie dotykało CRM, lejek pokazywał
// „nowy kontakt" dla kogoś, kto od miesiąca ma plan Pro - a firma tej osoby
// nie istniała w katalogu firm, więc raporty per organizacja były niepełne.
//
// ZASADA. Profil jest źródłem prawdy o osobie (imię, nazwisko, stanowisko,
// firma), CRM jest jego odbiciem. Synchronizacja jest idempotentna: dedup
// osoby po `email_norm`, dedup firmy po znormalizowanej nazwie w tenancie.
//
// ODPORNOŚĆ. syncMemberToCrm nigdy nie rzuca - nieudany zapis CRM nie może cofnąć
// nadania planu, które już zapisało się w `membership_grants`.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

// The generator cannot infer nullable PostgreSQL function arguments. Keep this
// SQL contract outside types.ts so regenerating it cannot turn revoke/backfill
// nulls into unsafe casts or omitted required arguments.
type Functions = Database["public"]["Functions"];
type SyncArgs = Omit<Functions["crm_sync_member"]["Args"], "p_tier_key" | "p_actor_id"> & {
  p_tier_key: string | null;
  p_actor_id: string | null;
};
type CrmSchema = Omit<Database["public"], "Functions"> & {
  Functions: Omit<Functions, "crm_sync_member"> & {
    crm_sync_member: Omit<Functions["crm_sync_member"], "Args"> & { Args: SyncArgs };
  };
};
type CrmAdmin = SupabaseClient<Omit<Database, "public"> & { public: CrmSchema }>;

const syncResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("synced"),
    leadId: z.string().uuid(),
    stage: z.string(),
    companyId: z.string().uuid().nullable(),
    companyName: z.string().nullable(),
    companyCreated: z.boolean(),
  }),
  z.object({ status: z.literal("skipped") }),
  z.object({ status: z.literal("failed"), errorCode: z.string() }),
]);

export interface MemberCrmSnapshot {
  leadId: string | null;
  stage: string | null;
  companyId: string | null;
  companyName: string | null;
  companyCreated: boolean;
}

/** Nazwa firmy sprowadzona do postaci porównywalnej (dedup w obrębie tenanta). */
export function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .replace(/\b(sp\.? ?z ?o\.? ?o\.?|s\.?a\.?|ltd|llc|inc|gmbh)\b/g, "")
    .trim();
}

/** Zwraca id firmy w CRM, tworząc ją przy pierwszym wystąpieniu. */
export async function ensureCrmCompany(
  supabaseAdmin: Admin,
  tenantId: string,
  rawName: string | null,
  createdBy: string | null,
): Promise<string | null> {
  if (!rawName?.trim() || !normalizeCompanyName(rawName)) return null;
  const { data, error } = await supabaseAdmin.rpc("crm_ensure_member_company", {
    p_tenant_id: tenantId,
    p_name: rawName,
    p_actor_id: createdBy ?? undefined,
  });
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

interface SyncInput {
  userId: string;
  tenantId: string;
  /** Warstwa po zmianie; `null` = nadanie cofnięte. */
  tierKey: string | null;
  actorId: string | null;
  /** Skąd wynika zmiana - trafia do tagów kontaktu. */
  reason: "manual_grant" | "manual_revoke" | "backfill";
}

/**
 * Odbija stan członkostwa w CRM: kontakt (osoba) + firma, tagi planu i etap.
 * Nigdy nie rzuca.
 */
export async function syncMemberToCrm(
  supabaseAdmin: Admin,
  input: SyncInput,
): Promise<MemberCrmSnapshot | null> {
  try {
    const { data, error } = await (supabaseAdmin as CrmAdmin).rpc("crm_sync_member", {
      p_user_id: input.userId,
      p_tenant_id: input.tenantId,
      p_tier_key: input.tierKey,
      p_actor_id: input.actorId,
      p_reason: input.reason,
    });
    if (error) throw error;
    const result = syncResult.parse(data);
    if (result.status === "failed") {
      console.error("[members] crm sync pending", { userId: input.userId, code: result.errorCode });
      return null;
    }
    if (result.status === "skipped") return null;
    return {
      leadId: result.leadId,
      stage: result.stage,
      companyId: result.companyId,
      companyName: result.companyName,
      companyCreated: result.companyCreated,
    };
  } catch (err) {
    console.error("[members] crm sync failed", err);
    return null;
  }
}
