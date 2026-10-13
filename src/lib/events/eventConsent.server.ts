// Zgody uczestnika wydarzeń - logika server-only dla `eventConsent.functions.ts`
// (REG-02 / REG-14, decyzja D5).
//
// SKĄD TOŻSAMOŚĆ. Nic z ciała żądania:
//   * najemca - zaufany host (`resolveTenantIdForHost(currentTenantHost())`);
//     `supabaseAdmin` nie niesie hosta, więc `public_tenant_id()` wskazałby
//     najemcę domyślnego - najemca idzie do RPC JAWNIE; host bez najemcy to
//     awaria, nie odpowiedź o linku;
//   * konto - zweryfikowana sesja (`optionalUserIdFromRequest`, `getClaims`);
//   * adres - solony skrót (`requestRateSubject`, `ip:<32 hex>`), nigdy surowy
//     adres i nigdy nagłówek czytany tutaj (`check:client-ip-source`);
//   * przeglądarka - nagłówek `user-agent` przycięty do 400 znaków (metadana
//     dowodu zgody, sufit kolumn w bazie).
// Osobę baza bierze WYŁĄCZNIE z poświadczenia (token linku, klucz
// samoobsługi, konto z sesji) - identyfikatora osoby ani adresu ten moduł
// w ogóle nie przekazuje.
//
// OKNO WDROŻENIA („najpierw kod"). Funkcje RPC są nowe; dopóki migracji nie
// ma (PGRST202/42883), nie ma też żadnej starszej drogi - odpowiadamy stanem
// `unavailable`, a interfejs mówi „spróbuj później", zamiast udawać, że link
// wygasł albo zgoda została wycofana.
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import { optionalUserIdFromRequest } from "@/lib/auth/optionalUser.server";
import {
  parseEventConsentConfirm,
  parseEventConsentPreview,
  parseEventConsentWithdraw,
  parseMyEventConsentState,
  type EventConsentConfirmResult,
  type EventConsentPreviewResult,
  type EventConsentWithdrawResult,
  type EventConsentWithdrawScope,
  type MyEventConsentStateResult,
} from "@/lib/events/eventConsent";
import { callerSupabase } from "@/lib/events/callerClient.server";
import { currentTenantHost } from "@/lib/http/requestHost";
import { requestRateSubject } from "@/lib/server/rateSubject.server";
import { resolveTenantIdForHost } from "@/lib/server/tenant.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

/** Sufit nagłówka `user-agent` - ten sam, co kolumn dowodu zgody w bazie. */
export const CONSENT_USER_AGENT_MAX = 400;

type ConfirmArgs = Database["public"]["Functions"]["event_consent_confirm_for_request"]["Args"];
type WithdrawArgs = Database["public"]["Functions"]["event_consent_withdraw_for_request"]["Args"];

function requestHeaders(): Headers | null {
  try {
    return getRequest().headers;
  } catch {
    return null;
  }
}

async function requestTenantId(): Promise<string | null> {
  try {
    return await resolveTenantIdForHost(await currentTenantHost());
  } catch {
    return null;
  }
}

/** Tożsamość żądania dla RPC zapisujących dowód: adres i przeglądarka z serwera. */
function requestEvidence(): { ipSubject: string; userAgent: string | null } {
  const headers = requestHeaders();
  return {
    ipSubject: requestRateSubject(headers),
    userAgent: headers?.get("user-agent")?.trim().slice(0, CONSENT_USER_AGENT_MAX) || null,
  };
}

/** Podgląd linku z maila (GET strony) - niczego nie zmienia. */
export async function previewEventConsentForRequest(
  token: string,
): Promise<EventConsentPreviewResult> {
  const tenantId = await requestTenantId();
  if (!tenantId) {
    console.error("[events] consent preview: tenant unresolved for host");
    return { ok: false, reason: "error" };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_consent_confirmation_preview", {
    _tenant_id: tenantId,
    p_token: token,
  });
  if (error) {
    if (isMigrationPending(error)) return { ok: false, reason: "unavailable" };
    console.error("[events] consent preview failed", error.code ?? "", error.message);
    return { ok: false, reason: "error" };
  }
  return { ok: true, preview: parseEventConsentPreview(data) };
}

/**
 * Potwierdzenie linku (przycisk, POST). Konto z sesji, gdy jest - trafia do
 * dowodu jako potwierdzający; link działa też bez logowania.
 */
export async function confirmEventConsentForRequest(
  token: string,
): Promise<EventConsentConfirmResult> {
  const tenantId = await requestTenantId();
  if (!tenantId) {
    console.error("[events] consent confirm: tenant unresolved for host");
    return { ok: false, state: "error" };
  }
  const userId = await optionalUserIdFromRequest();
  const { ipSubject, userAgent } = requestEvidence();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_consent_confirm_for_request", {
    _tenant_id: tenantId,
    // NULL = potwierdzenie bez logowania - wygenerowany typ argumentu go nie
    // zna, więc zawężamy jawnie (jak `event_register_for_client`).
    _user_id: userId as ConfirmArgs["_user_id"],
    _ip_subject: ipSubject,
    _user_agent: userAgent as ConfirmArgs["_user_agent"],
    p_token: token,
  });
  if (error) {
    if (isMigrationPending(error)) return { ok: false, state: "unavailable" };
    console.error("[events] consent confirm failed", error.code ?? "", error.message);
    return { ok: false, state: "error" };
  }
  return parseEventConsentConfirm(data);
}

export interface WithdrawEventConsentsInput {
  purposes: EventConsentWithdrawScope;
  /** Klucz samoobsługi; bez niego osobę wskazuje wyłącznie konto z sesji. */
  manageToken?: string | null;
}

/**
 * Wycofanie zgód marketingu/partnerów. Poświadczeniem jest klucz samoobsługi
 * ALBO sesja - bez żadnego z nich nie ma czyich zgód wycofać, więc baza
 * nawet nie jest pytana (i nie liczy kubełka).
 */
export async function withdrawEventConsentsForRequest(
  input: WithdrawEventConsentsInput,
): Promise<EventConsentWithdrawResult> {
  const manageToken = input.manageToken ?? null;
  const userId = await optionalUserIdFromRequest();
  if (manageToken === null && userId === null) return { ok: false, reason: "no_credential" };

  const tenantId = await requestTenantId();
  if (!tenantId) {
    console.error("[events] consent withdraw: tenant unresolved for host");
    return { ok: false, reason: "error" };
  }
  const { ipSubject, userAgent } = requestEvidence();
  // Ładunek budowany od zera: wyłącznie cele i klucz. Żaden identyfikator
  // osoby ani adres nie ma tu wejścia - baza i tak by go zignorowała.
  const payload: { purposes: EventConsentWithdrawScope; manage_token?: string } = {
    purposes: input.purposes,
  };
  if (manageToken !== null) payload.manage_token = manageToken;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("event_consent_withdraw_for_request", {
    _tenant_id: tenantId,
    _user_id: userId as WithdrawArgs["_user_id"],
    _ip_subject: ipSubject,
    _user_agent: userAgent as WithdrawArgs["_user_agent"],
    p_payload: payload,
  });
  if (error) {
    if (isMigrationPending(error)) return { ok: false, reason: "unavailable" };
    console.error("[events] consent withdraw failed", error.code ?? "", error.message);
    return { ok: false, reason: "error" };
  }
  return parseEventConsentWithdraw(data);
}

/**
 * Zgody zalogowanego uczestnika w najemcy HOSTA. Klient wołającego z nagłówkiem
 * hosta (`callerSupabase`): `event_my_consent_state` czyta osobę po
 * `auth.uid()` i najemcę z `public_tenant_id()` - klient z kluczem serwisowym
 * nie miałby ani konta, ani hosta.
 */
export async function listMyEventConsentsForCaller(): Promise<MyEventConsentStateResult> {
  const { client } = await callerSupabase();
  const { data, error } = await client.rpc("event_my_consent_state");
  if (error) {
    if (isMigrationPending(error)) return { ok: false, reason: "unavailable" };
    console.error("[events] my consent state failed", error.code ?? "", error.message);
    return { ok: false, reason: "error" };
  }
  return { ok: true, state: parseMyEventConsentState(data) };
}
