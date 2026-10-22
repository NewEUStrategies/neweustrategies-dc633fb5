// REJESTR SZYBKICH NAPRAW DIAGNOSTYKI (S7, SPEC §6.4) - treść
// `QuickFixDialog`: rozwiązania, różnica „Przed → Po", rola zapisu
// i referencja do WSPÓŁDZIELONEGO mutatora modułu.
//
// HUB NIE MA WŁASNEJ ŚCIEŻKI ZAPISU (SPEC §3.1, I1). Każda naprawa woła ten
// sam mutator, którym moduł źródłowy zapisuje swój byt (`HUB_SYNC_MANIFEST.
// writers`): ten sam patch jawnych kolumn, ta sama współbieżność
// optymistyczna (`updated_at` → 40001), te same inwalidacje i zdarzenie
// szyny. Własne `.from(...).update` w hubie byłoby drugim pisarzem - test
// (`quickFixes.test.ts`) przeszukuje ten plik i każdy pisarz musi być też
// importowany przez moduł źródłowy.
//
// TOKEN Z ŚWIEŻEGO ODCZYTU. Przed zapisem aplikator czyta wiersz kluczem
// modułu (`fetchQuery`, `staleTime: 0`) - ten sam wpis cache co ekran
// modułu - i dopiero z jego `updated_at` woła mutator. Konflikt (`40001`)
// zostaje więc wyłącznie dla zapisu z innej karty w tej samej chwili
// i wraca do dialogu jako stan „zmienione w innym miejscu".
//
// ROLA = ROLA ZAPISU MODUŁU (`requiredRole`), nie rola huba: warstwy
// i retencja tylko administrator (polityki `… admin write`), plany, reguły
// dostępu, licznik, kasa, newsletter, kampanie, przepisy i CRM - administrator
// albo redaktor. Przycisk „Zastosuj" bez roli jest wyłączony z podpowiedzią.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { adminMembershipTiersQueryOptions } from "@/components/admin/membership/membershipQueries";
import {
  contentAccessRuleQueryOptions,
  useSaveContentAccessRule,
  type AccessEntityType,
} from "@/lib/access/contentAccessQueries";
import { meteringSettingsQueryOptions } from "@/lib/access/metering";
import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
import { useSaveMeteringSettings } from "@/lib/access/meteringQueries";
import { couponCampaignsQueryOptions, useSetCampaignStatus } from "@/lib/admin/couponQueries";
import { useSetWorkflowEnabled } from "@/lib/admin/workflowQueries";
import { adminPlansAllQueryOptions, useSaveAccessPlanPatch } from "@/lib/billing/planQueries";
import { useSaveTierMarketing } from "@/lib/billing/tierMutations";
import { assignUnassignedCrmTasks } from "@/lib/crm-tasks.functions";
import { bulkUpdateCrmLeads } from "@/lib/crm.functions";
import { checkoutSettingsQueryOptions, useSaveCheckoutSettings } from "@/hooks/useCheckoutSettings";
import { newsletterSettingsQueryOptions } from "@/hooks/useNewsletterSettings";
import { usePatchNewsletterSettings } from "@/lib/newsletter/settingsQueries";
import { useSaveRetentionSettings } from "@/lib/retention/mutations";
import { retentionSettingsQueryOptions } from "@/lib/retention/queries";
import { isCheckoutAbandonMinutes } from "@/lib/revenue/limits";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import type {
  RevenueCheckId,
  RevenueFinding,
  RevenueFixDialogId,
} from "@/lib/revenue/diagnostics/registry";
import type { HubEntityId } from "@/lib/revenue/syncManifest";

// ---------------------------------------------------------------------------
// Kontrakt (SPEC §6.4)
// ---------------------------------------------------------------------------

/** Wartość w podglądzie różnicy: tekst wprost albo klucz słownika. */
export type QuickFixValue =
  { text: string } | { key: string; params?: Readonly<Record<string, string | number>> };

/** Wiersz podglądu „Przed → Po" (SPEC §6.4: `FieldDiff`). */
export interface FieldDiff {
  /** Kolumna bytu źródłowego (do `SourceHeader`). */
  field: string;
  /** Klucz etykiety pola: `adminRevenue.fix.field.<kolumna>`. */
  labelKey: string;
  before: QuickFixValue;
  after: QuickFixValue;
}

export interface QuickFixOption<F> {
  /** Stabilny identyfikator rozwiązania w dialogu (radio). */
  id: string;
  /** `adminRevenue.fix.<dialog>.option.<id>`. */
  labelKey: string;
  labelParams?: Readonly<Record<string, string | number>>;
  /** Ładunek startowy - treść (`body`) może go uzupełnić (osoba, adres, liczba). */
  payload: F;
}

/** Wynik zapisu: odwrócenie dla „Cofnij" (60 s) przy zmianach odwracalnych. */
export interface QuickFixApplied {
  revert?: () => Promise<void>;
}

export interface QuickFixApplier<F> {
  apply(payload: F): Promise<QuickFixApplied>;
}

/** Referencja do pisarza z manifestu i hak, który go woła (SPEC §6.4 `apply`). */
export interface QuickFixMutatorRef<F> {
  /** `HubWriter.ref` z `HUB_SYNC_MANIFEST` (`ścieżka#eksport` albo nazwa RPC). */
  writer: string;
  /** Eksport, który moduł źródłowy także importuje (mutator albo server fn). */
  moduleExport: string;
  entity: HubEntityId;
  columns: readonly string[];
  useApplier(): QuickFixApplier<F>;
}

export interface QuickFixBodyProps<F> {
  facts: RevenueFacts;
  finding: RevenueFinding;
  option: QuickFixOption<F>;
  value: F;
  onChange(value: F): void;
  disabled: boolean;
}

export type QuickFixBody<F> = ComponentType<QuickFixBodyProps<F>>;

export type QuickFixRole = "admin" | "editor" | "platform_admin";

export interface QuickFixSpec<F> {
  id: RevenueFixDialogId;
  checkIds: readonly RevenueCheckId[];
  requiredRole: QuickFixRole;
  options(facts: RevenueFacts, finding: RevenueFinding): QuickFixOption<F>[];
  diff(option: QuickFixOption<F>, facts: RevenueFacts, value: F): FieldDiff[];
  /** Czy ładunek jest kompletny („Zastosuj" włączone). Brak = zawsze. */
  valid?(value: F): boolean;
  apply: QuickFixMutatorRef<F>;
  body?: LazyExoticComponent<QuickFixBody<F>>;
  reversible: boolean;
}

/** Czy rola sesji może zapisać (role DOKŁADNE - `super_admin` sam nie wystarcza). */
export function canApplyQuickFix(role: QuickFixRole, roles: readonly string[]): boolean {
  if (role === "platform_admin") return roles.includes("super_admin");
  if (role === "admin") return roles.includes("admin");
  return roles.includes("admin") || roles.includes("editor");
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

const text = (value: string | number | null | undefined): QuickFixValue => ({
  text: value === null || value === undefined || value === "" ? "-" : String(value),
});
const key = (k: string, params?: Record<string, string | number>): QuickFixValue => ({
  key: `adminRevenue.fix.value.${k}`,
  params,
});
const bool = (value: boolean | null | undefined): QuickFixValue =>
  value === null || value === undefined ? key("missing") : key(value ? "on" : "off");

function field(name: string, before: QuickFixValue, after: QuickFixValue): FieldDiff {
  return { field: name, labelKey: `adminRevenue.fix.field.${name}`, before, after };
}

/**
 * Świeży odczyt wpisu cache modułu (`staleTime: 0`): token zapisu sprzed
 * sekund, nie minut - ten sam wpis odświeża przy okazji ekran modułu.
 */
const FRESH = { staleTime: 0 } as const;

/** Plany diagnozy z faktów (refs = uuid planów). */
function plansOf(facts: RevenueFacts, finding: RevenueFinding) {
  const plans = facts.areas.catalog?.plans ?? [];
  return finding.refs
    .map((id) => plans.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
}

/** `post:<uuid>` → para encji reguły dostępu (reszta typów odpada). */
function accessRef(ref: string): { entityType: AccessEntityType; entityId: string } | null {
  const [type, id] = ref.split(":");
  if ((type === "post" || type === "page" || type === "media") && id) {
    return { entityType: type, entityId: id };
  }
  return null;
}

const fixBody = <F>(load: () => Promise<{ default: QuickFixBody<F> }>) => lazy(load);

// ---------------------------------------------------------------------------
// Ładunki
// ---------------------------------------------------------------------------

export interface PlanTierPayload {
  planIds: readonly string[];
  tierKey: string | null;
}
export interface PlanIdsPayload {
  planIds: readonly string[];
}
export interface TierKeysPayload {
  tierKeys: readonly string[];
}
export interface AccessRulePayload {
  mode: "remove_dead" | "assign";
  refs: readonly string[];
  deadPlanIds: readonly string[];
  planId: string | null;
}
export interface NumberPayload {
  value: number | null;
}
export interface CampaignStatusPayload {
  campaignIds: readonly string[];
  status: "draft" | "archived";
}
export interface AssignTasksPayload {
  useFallback: boolean;
  fallbackAssigneeId: string | null;
}
export interface AssignOwnerPayload {
  leadIds: readonly string[];
  ownerId: string | null;
}
export interface SenderPayload {
  email: string;
  name: string;
}
export interface WorkflowIdsPayload {
  workflowIds: readonly string[];
}
export type EmptyPayload = Readonly<Record<string, never>>;

/**
 * Adres nadawcy: kształt e-maila bez spacji - pełną walidację (domena
 * zweryfikowana u dostawcy) robi zapis i ekran newslettera.
 */
export const SENDER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATFORM_SENDER = "onboarding@resend.dev";

/** DEFAULT kolumn `retention_settings` (20260722230000) - zapis przy braku wiersza. */
export const RETENTION_COLUMN_DEFAULTS = {
  discount_pct: 30,
  discount_periods: 3,
  coupon_valid_days: 14,
} as const;

// ---------------------------------------------------------------------------
// Aplikatory (hooki wołane w dialogu - zawsze w tej samej kolejności)
// ---------------------------------------------------------------------------

function usePlanPatchApplier<F>(
  owner: "membership" | "paywall",
  patchOf: (payload: F) => { ids: readonly string[]; patch: Record<string, unknown> },
  revertPatch: (
    payload: F,
    row: { tier_key: string | null; active: boolean; for_sale: boolean },
  ) => Record<string, unknown>,
): QuickFixApplier<F> {
  const qc = useQueryClient();
  const save = useSaveAccessPlanPatch(owner);
  return {
    async apply(payload) {
      const { ids, patch } = patchOf(payload);
      const rows = await qc.fetchQuery({ ...adminPlansAllQueryOptions(), ...FRESH });
      const undo: { id: string; token: string; patch: Record<string, unknown> }[] = [];
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        const saved = await save.mutateAsync({
          id,
          expectedUpdatedAt: row.updated_at,
          patch: patch as never,
        });
        undo.push({ id, token: saved.updated_at, patch: revertPatch(payload, row) });
      }
      return {
        revert: async () => {
          for (const step of undo) {
            await save.mutateAsync({
              id: step.id,
              expectedUpdatedAt: step.token,
              patch: step.patch as never,
            });
          }
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Rejestr
// ---------------------------------------------------------------------------

type PayloadOf = {
  plan_tier: PlanTierPayload;
  plan_deactivate: PlanIdsPayload;
  plan_not_for_sale: PlanIdsPayload;
  tier_hide: TierKeysPayload;
  access_rule_plan: AccessRulePayload;
  metering_defaults: EmptyPayload;
  metering_anon_limit: NumberPayload;
  checkout_abandon_window: NumberPayload;
  campaign_status: CampaignStatusPayload;
  retention_enable: EmptyPayload;
  crm_assign_tasks: AssignTasksPayload;
  crm_assign_owner: AssignOwnerPayload;
  newsletter_doi: EmptyPayload;
  newsletter_sender: SenderPayload;
  workflow_disable: WorkflowIdsPayload;
};

export const QUICK_FIXES: { readonly [K in RevenueFixDialogId]: QuickFixSpec<PayloadOf[K]> } = {
  plan_tier: {
    id: "plan_tier",
    checkIds: ["catalog.plan_without_tier"],
    requiredRole: "editor",
    options: (facts, finding) => [
      {
        id: "assign",
        labelKey: "adminRevenue.fix.plan_tier.option.assign",
        labelParams: { count: plansOf(facts, finding).length },
        payload: { planIds: plansOf(facts, finding).map((p) => p.id), tierKey: null },
      },
    ],
    diff: (option, facts, value) => [
      field(
        "tier_key",
        text(
          (facts.areas.catalog?.plans ?? []).find((p) => option.payload.planIds.includes(p.id))
            ?.tierKey ?? null,
        ),
        text(value.tierKey),
      ),
    ],
    valid: (value) => value.tierKey !== null && value.planIds.length > 0,
    apply: {
      writer: "src/lib/billing/planQueries.ts#useSaveAccessPlanPatch",
      moduleExport: "useSaveAccessPlanPatch",
      entity: "access_plan",
      columns: ["tier_key"],
      useApplier: () =>
        usePlanPatchApplier<PlanTierPayload>(
          "membership",
          (p) => ({ ids: p.planIds, patch: { tier_key: p.tierKey } }),
          (_p, row) => ({ tier_key: row.tier_key }),
        ),
    },
    body: fixBody(() => import("@/components/admin/revenue/diagnostics/fixes/TierSelectBody")),
    reversible: true,
  },
  plan_deactivate: {
    id: "plan_deactivate",
    checkIds: ["catalog.plan_without_catalog_pair"],
    requiredRole: "editor",
    options: (facts, finding) => {
      const plans = plansOf(facts, finding).filter((p) => p.active);
      return [
        {
          id: "deactivate",
          labelKey: "adminRevenue.fix.plan_deactivate.option.deactivate",
          labelParams: { count: plans.length },
          payload: { planIds: plans.map((p) => p.id) },
        },
      ];
    },
    diff: () => [field("active", bool(true), bool(false))],
    valid: (value) => value.planIds.length > 0,
    apply: {
      writer: "src/lib/billing/planQueries.ts#useSaveAccessPlanPatch",
      moduleExport: "useSaveAccessPlanPatch",
      entity: "access_plan",
      columns: ["active"],
      useApplier: () =>
        usePlanPatchApplier<PlanIdsPayload>(
          "paywall",
          (p) => ({ ids: p.planIds, patch: { active: false } }),
          (_p, row) => ({ active: row.active }),
        ),
    },
    reversible: true,
  },
  plan_not_for_sale: {
    id: "plan_not_for_sale",
    checkIds: ["catalog.enquiry_plan_buyable"],
    requiredRole: "editor",
    options: (facts, finding) => {
      const plans = plansOf(facts, finding).filter((p) => p.forSale);
      return [
        {
          id: "withdraw",
          labelKey: "adminRevenue.fix.plan_not_for_sale.option.withdraw",
          labelParams: { count: plans.length },
          payload: { planIds: plans.map((p) => p.id) },
        },
      ];
    },
    diff: () => [field("for_sale", bool(true), bool(false))],
    valid: (value) => value.planIds.length > 0,
    apply: {
      writer: "src/lib/billing/planQueries.ts#useSaveAccessPlanPatch",
      moduleExport: "useSaveAccessPlanPatch",
      entity: "access_plan",
      columns: ["for_sale"],
      useApplier: () =>
        usePlanPatchApplier<PlanIdsPayload>(
          "paywall",
          (p) => ({ ids: p.planIds, patch: { for_sale: false } }),
          (_p, row) => ({ for_sale: row.for_sale }),
        ),
    },
    reversible: true,
  },
  tier_hide: {
    id: "tier_hide",
    checkIds: ["catalog.not_for_sale_still_visible"],
    requiredRole: "admin",
    options: (_facts, finding) => [
      {
        id: "hide",
        labelKey: "adminRevenue.fix.tier_hide.option.hide",
        labelParams: { count: finding.refs.length },
        payload: { tierKeys: finding.refs },
      },
    ],
    diff: () => [field("pricing_visible", bool(true), bool(false))],
    valid: (value) => value.tierKeys.length > 0,
    apply: {
      writer: "src/lib/billing/tierMutations.ts#useSaveTierMarketing",
      moduleExport: "useSaveTierMarketing",
      entity: "membership_tier",
      columns: ["pricing_visible"],
      useApplier: function useTierHideApplier(): QuickFixApplier<TierKeysPayload> {
        const qc = useQueryClient();
        const save = useSaveTierMarketing();
        return {
          async apply(payload) {
            const tiers = await qc.fetchQuery({ ...adminMembershipTiersQueryOptions(), ...FRESH });
            const undo: { id: string; token: string }[] = [];
            for (const tierKey of payload.tierKeys) {
              const tier = tiers.find((t) => t.key === tierKey);
              if (!tier) continue;
              const saved = await save.mutateAsync({
                id: tier.id,
                expectedUpdatedAt: tier.updated_at,
                patch: { pricing_visible: false },
              });
              undo.push({ id: tier.id, token: saved.updated_at });
            }
            return {
              revert: async () => {
                for (const step of undo) {
                  await save.mutateAsync({
                    id: step.id,
                    expectedUpdatedAt: step.token,
                    patch: { pricing_visible: true },
                  });
                }
              },
            };
          },
        };
      },
    },
    reversible: true,
  },
  access_rule_plan: {
    id: "access_rule_plan",
    checkIds: ["paywall.paid_without_buyable_plan", "paywall.rule_inactive_plan"],
    requiredRole: "editor",
    options: (facts, finding) => {
      const dead = facts.areas.paywall?.danglingRules?.planIds ?? [];
      const base = { refs: finding.refs, deadPlanIds: dead, planId: null };
      const assign: QuickFixOption<AccessRulePayload> = {
        id: "assign",
        labelKey: "adminRevenue.fix.access_rule_plan.option.assign",
        labelParams: { count: finding.refs.length },
        payload: { ...base, mode: "assign" },
      };
      if (finding.checkId !== "paywall.rule_inactive_plan") return [assign];
      return [
        {
          id: "remove_dead",
          labelKey: "adminRevenue.fix.access_rule_plan.option.remove_dead",
          labelParams: { count: finding.refs.length },
          payload: { ...base, mode: "remove_dead" },
        },
        assign,
      ];
    },
    diff: (_option, _facts, value) => [
      field(
        "plan_ids",
        key("rulePlans", { count: value.refs.length }),
        value.mode === "remove_dead"
          ? key("rulePlansWithoutDead", { count: value.deadPlanIds.length })
          : key("rulePlansWithAssigned"),
      ),
    ],
    valid: (value) =>
      value.refs.length > 0 && (value.mode === "remove_dead" || value.planId !== null),
    apply: {
      writer: "src/lib/access/contentAccessQueries.ts#useSaveContentAccessRule",
      moduleExport: "useSaveContentAccessRule",
      entity: "content_access",
      columns: ["plan_ids"],
      useApplier: function useAccessRuleApplier(): QuickFixApplier<AccessRulePayload> {
        const qc = useQueryClient();
        const save = useSaveContentAccessRule();
        return {
          async apply(payload) {
            const undo: {
              entityType: AccessEntityType;
              entityId: string;
              token: string;
              planIds: string[];
            }[] = [];
            for (const ref of payload.refs) {
              const target = accessRef(ref);
              if (!target) continue;
              const rule = await qc.fetchQuery({
                ...contentAccessRuleQueryOptions(target.entityType, target.entityId),
                ...FRESH,
              });
              if (!rule) continue;
              const kept = rule.plan_ids.filter((id) => !payload.deadPlanIds.includes(id));
              const next =
                payload.mode === "assign" &&
                payload.planId !== null &&
                !kept.includes(payload.planId)
                  ? [...kept, payload.planId]
                  : kept;
              const saved = await save.mutateAsync({
                ...target,
                fields: { plan_ids: next },
                expectedUpdatedAt: rule.updated_at,
              });
              undo.push({ ...target, token: saved.updated_at, planIds: rule.plan_ids });
            }
            return {
              revert: async () => {
                for (const step of undo) {
                  await save.mutateAsync({
                    entityType: step.entityType,
                    entityId: step.entityId,
                    fields: { plan_ids: step.planIds },
                    expectedUpdatedAt: step.token,
                  });
                }
              },
            };
          },
        };
      },
    },
    body: fixBody(() => import("@/components/admin/revenue/diagnostics/fixes/PlanSelectBody")),
    reversible: true,
  },
  metering_defaults: {
    id: "metering_defaults",
    checkIds: ["metering.settings_row_missing"],
    requiredRole: "editor",
    options: () => [
      {
        id: "defaults",
        labelKey: "adminRevenue.fix.metering_defaults.option.defaults",
        labelParams: { members: METERING_DEFAULTS.member_monthly_limit },
        payload: {},
      },
    ],
    diff: () => [
      field("enabled", key("missing"), bool(METERING_DEFAULTS.enabled)),
      field("member_monthly_limit", key("missing"), text(METERING_DEFAULTS.member_monthly_limit)),
      field("anon_monthly_limit", key("missing"), text(METERING_DEFAULTS.anon_monthly_limit)),
    ],
    apply: {
      writer: "src/lib/access/meteringQueries.ts#useSaveMeteringSettings",
      moduleExport: "useSaveMeteringSettings",
      entity: "metering",
      columns: ["enabled", "member_monthly_limit", "anon_monthly_limit"],
      useApplier: function useMeteringDefaultsApplier(): QuickFixApplier<EmptyPayload> {
        const save = useSaveMeteringSettings();
        return {
          async apply() {
            // Brak wiersza = INSERT (token `null`); wiersz utworzony w innej
            // karcie kończy się 23505 → 40001 (konflikt w dialogu).
            await save.mutateAsync({ settings: { ...METERING_DEFAULTS }, expectedUpdatedAt: null });
            return {};
          },
        };
      },
    },
    body: fixBody(() => import("@/components/admin/revenue/diagnostics/fixes/MeteringImpactBody")),
    reversible: false,
  },
  metering_anon_limit: {
    id: "metering_anon_limit",
    checkIds: ["metering.anon_zero_limit"],
    requiredRole: "editor",
    options: (facts) => {
      const members = facts.areas.metering?.memberMonthlyLimit ?? null;
      const custom: QuickFixOption<NumberPayload> = {
        id: "custom",
        labelKey: "adminRevenue.fix.metering_anon_limit.option.custom",
        payload: { value: null },
      };
      if (members === null || members <= 0) return [custom];
      return [
        {
          id: "same_as_members",
          labelKey: "adminRevenue.fix.metering_anon_limit.option.same_as_members",
          labelParams: { count: members },
          payload: { value: members },
        },
        custom,
      ];
    },
    diff: (_option, facts, value) => [
      field(
        "anon_monthly_limit",
        text(facts.areas.metering?.anonMonthlyLimit ?? null),
        text(value.value),
      ),
    ],
    valid: (value) => value.value !== null && Number.isInteger(value.value) && value.value > 0,
    apply: {
      writer: "src/lib/access/meteringQueries.ts#useSaveMeteringSettings",
      moduleExport: "useSaveMeteringSettings",
      entity: "metering",
      columns: ["anon_monthly_limit"],
      useApplier: function useAnonLimitApplier(): QuickFixApplier<NumberPayload> {
        const qc = useQueryClient();
        const save = useSaveMeteringSettings();
        return {
          async apply(payload) {
            const row = await qc.fetchQuery({ ...meteringSettingsQueryOptions(), ...FRESH });
            if (!row || payload.value === null) throw new Error("metering_row_missing");
            const { updated_at: token, ...settings } = row;
            const saved = await save.mutateAsync({
              settings: { ...settings, anon_monthly_limit: payload.value },
              expectedUpdatedAt: token,
            });
            return {
              revert: async () => {
                await save.mutateAsync({ settings, expectedUpdatedAt: saved.updated_at });
              },
            };
          },
        };
      },
    },
    body: fixBody(() => import("@/components/admin/revenue/diagnostics/fixes/NumberBody")),
    reversible: true,
  },
  checkout_abandon_window: {
    id: "checkout_abandon_window",
    checkIds: ["checkout.abandon_window_default"],
    requiredRole: "editor",
    options: () => [
      {
        id: "custom",
        labelKey: "adminRevenue.fix.checkout_abandon_window.option.custom",
        payload: { value: null },
      },
    ],
    diff: (_option, facts, value) => [
      field(
        "abandon_after_minutes",
        text(facts.areas.checkout?.abandonAfterMinutes ?? null),
        text(value.value),
      ),
    ],
    // Ten sam predykat co karta kasy i serwer (30-1440, odrzucenie, nie przycięcie).
    valid: (value) => isCheckoutAbandonMinutes(value.value),
    apply: {
      writer: "src/hooks/useCheckoutSettings.ts#useSaveCheckoutSettings",
      moduleExport: "useSaveCheckoutSettings",
      entity: "checkout_settings",
      columns: ["abandon_after_minutes"],
      useApplier: function useAbandonApplier(): QuickFixApplier<NumberPayload> {
        const qc = useQueryClient();
        const save = useSaveCheckoutSettings();
        return {
          async apply(payload) {
            const state = await qc.fetchQuery({ ...checkoutSettingsQueryOptions(), ...FRESH });
            if (payload.value === null) throw new Error("abandon_minutes_invalid");
            const { updated_at: token, ...settings } = state;
            const saved = await save.mutateAsync({
              settings: { ...settings, abandon_after_minutes: payload.value },
              expectedUpdatedAt: token,
            });
            const previous = settings.abandon_after_minutes;
            return previous === undefined
              ? {}
              : {
                  revert: async () => {
                    await save.mutateAsync({
                      settings: { ...settings, abandon_after_minutes: previous },
                      expectedUpdatedAt: saved.updated_at,
                    });
                  },
                };
          },
        };
      },
    },
    body: fixBody(() => import("@/components/admin/revenue/diagnostics/fixes/NumberBody")),
    reversible: true,
  },
  campaign_status: {
    id: "campaign_status",
    checkIds: ["coupons.campaign_sent_without_codes"],
    requiredRole: "editor",
    options: (_facts, finding) =>
      (["draft", "archived"] as const).map((status) => ({
        id: status,
        labelKey: `adminRevenue.fix.campaign_status.option.${status}`,
        labelParams: { count: finding.refs.length },
        payload: { campaignIds: finding.refs, status },
      })),
    diff: (_option, _facts, value) => [
      field("status", key("campaign_sent"), key(`campaign_${value.status}`)),
    ],
    valid: (value) => value.campaignIds.length > 0,
    apply: {
      writer: "src/lib/admin/couponQueries.ts#useSetCampaignStatus",
      moduleExport: "useSetCampaignStatus",
      entity: "coupon_campaign",
      columns: ["status"],
      useApplier: function useCampaignApplier(): QuickFixApplier<CampaignStatusPayload> {
        const qc = useQueryClient();
        const save = useSetCampaignStatus();
        return {
          async apply(payload) {
            const rows = await qc.fetchQuery({ ...couponCampaignsQueryOptions(), ...FRESH });
            for (const id of payload.campaignIds) {
              const row = rows.find((r) => r.id === id);
              if (!row) continue;
              await save.mutateAsync({
                campaignId: id,
                status: payload.status,
                expectedUpdatedAt: row.updated_at,
              });
            }
            // `sent` ustawia wyłącznie serwer po wysyłce (D-S1-06) - panel nie
            // ma drogi powrotu, więc naprawa jest nieodwracalna.
            return {};
          },
        };
      },
    },
    reversible: false,
  },
  retention_enable: {
    id: "retention_enable",
    checkIds: ["retention.not_configured"],
    requiredRole: "admin",
    options: (facts) => [
      {
        id: facts.areas.retention?.settingsRow ? "enable" : "create",
        labelKey: facts.areas.retention?.settingsRow
          ? "adminRevenue.fix.retention_enable.option.enable"
          : "adminRevenue.fix.retention_enable.option.create",
        labelParams: {
          percent: RETENTION_COLUMN_DEFAULTS.discount_pct,
          periods: RETENTION_COLUMN_DEFAULTS.discount_periods,
        },
        payload: {},
      },
    ],
    diff: (_option, facts) => [
      field(
        "enabled",
        facts.areas.retention?.settingsRow ? bool(facts.areas.retention.enabled) : key("missing"),
        bool(true),
      ),
    ],
    apply: {
      writer: "src/lib/retention/mutations.ts#useSaveRetentionSettings",
      moduleExport: "useSaveRetentionSettings",
      entity: "retention_settings",
      columns: ["enabled"],
      useApplier: function useRetentionApplier(): QuickFixApplier<EmptyPayload> {
        const qc = useQueryClient();
        const save = useSaveRetentionSettings();
        return {
          async apply() {
            const row = await qc.fetchQuery({
              ...retentionSettingsQueryOptions("admin"),
              ...FRESH,
            });
            const values = row
              ? {
                  discount_pct: row.discount_pct,
                  discount_periods: row.discount_periods,
                  coupon_valid_days: row.coupon_valid_days,
                }
              : { ...RETENTION_COLUMN_DEFAULTS };
            const saved = await save.mutateAsync({
              settings: { ...values, enabled: true },
              expectedUpdatedAt: row?.updated_at ?? null,
            });
            return {
              revert: async () => {
                await save.mutateAsync({
                  settings: { ...values, enabled: false },
                  expectedUpdatedAt: saved.updated_at,
                });
              },
            };
          },
        };
      },
    },
    reversible: true,
  },
  crm_assign_tasks: {
    id: "crm_assign_tasks",
    checkIds: ["crm.auto_tasks_without_assignee"],
    requiredRole: "editor",
    options: () => [
      {
        id: "owners",
        labelKey: "adminRevenue.fix.crm_assign_tasks.option.owners",
        payload: { useFallback: false, fallbackAssigneeId: null },
      },
      {
        id: "owners_and_fallback",
        labelKey: "adminRevenue.fix.crm_assign_tasks.option.owners_and_fallback",
        payload: { useFallback: true, fallbackAssigneeId: null },
      },
    ],
    diff: (_option, facts, value) => [
      field(
        "assignee_id",
        key("tasksUnassigned", { count: facts.areas.crm?.autoTasksUnassigned?.open ?? 0 }),
        key(value.useFallback ? "tasksToOwnersAndPerson" : "tasksToOwners"),
      ),
    ],
    valid: (value) => !value.useFallback || value.fallbackAssigneeId !== null,
    apply: {
      // Server fn S4 (P24) - pisarz `crm_task.writers` w manifeście (I9,
      // Z-S7-02) zamiast nieistniejącego `bulkUpdateCrmTasks`; ten sam
      // eksport woła lista CRM („Przypisz zadania bez osoby").
      writer: "src/lib/crm-tasks.functions.ts#assignUnassignedCrmTasks",
      moduleExport: "assignUnassignedCrmTasks",
      entity: "crm_task",
      columns: ["assignee_id"],
      useApplier: function useAssignTasksApplier(): QuickFixApplier<AssignTasksPayload> {
        const assign = useServerFn(assignUnassignedCrmTasks);
        const run = useMutation({
          mutationFn: (payload: AssignTasksPayload) =>
            assign({
              data: {
                fallback_assignee_id: payload.useFallback ? payload.fallbackAssigneeId : null,
              },
            }),
        });
        return {
          async apply(payload) {
            await run.mutateAsync(payload);
            // Przypisania nie da się cofnąć zbiorczo bez listy zadań sprzed zmiany.
            return {};
          },
        };
      },
    },
    body: fixBody<AssignTasksPayload>(
      () => import("@/components/admin/revenue/diagnostics/fixes/StaffPickerBody"),
    ),
    reversible: false,
  },
  crm_assign_owner: {
    id: "crm_assign_owner",
    checkIds: ["crm.qualified_without_owner"],
    requiredRole: "editor",
    options: (_facts, finding) => [
      {
        id: "owner",
        labelKey: "adminRevenue.fix.crm_assign_owner.option.owner",
        labelParams: { count: finding.refs.length },
        payload: { leadIds: finding.refs, ownerId: null },
      },
    ],
    diff: (_option, _facts, value) => [
      field("owner_id", key("noOwner"), key("ownerChosen", { count: value.leadIds.length })),
    ],
    valid: (value) => value.ownerId !== null && value.leadIds.length > 0,
    apply: {
      writer: "src/lib/crm.functions.ts#bulkUpdateCrmLeads",
      moduleExport: "bulkUpdateCrmLeads",
      entity: "crm_lead",
      columns: ["owner_id"],
      useApplier: function useAssignOwnerApplier(): QuickFixApplier<AssignOwnerPayload> {
        const update = useServerFn(bulkUpdateCrmLeads);
        const run = useMutation({
          mutationFn: (input: { ids: string[]; owner_id: string | null }) =>
            update({ data: input }),
        });
        return {
          async apply(payload) {
            const ids = [...payload.leadIds];
            await run.mutateAsync({ ids, owner_id: payload.ownerId });
            return {
              revert: async () => {
                await run.mutateAsync({ ids, owner_id: null });
              },
            };
          },
        };
      },
    },
    body: fixBody<AssignOwnerPayload>(
      () => import("@/components/admin/revenue/diagnostics/fixes/StaffPickerBody"),
    ),
    reversible: true,
  },
  newsletter_doi: {
    id: "newsletter_doi",
    checkIds: ["newsletter.doi_disabled"],
    requiredRole: "editor",
    options: () => [
      { id: "enable", labelKey: "adminRevenue.fix.newsletter_doi.option.enable", payload: {} },
    ],
    diff: () => [field("double_opt_in", bool(false), bool(true))],
    apply: {
      writer: "admin_newsletter_settings_patch",
      moduleExport: "usePatchNewsletterSettings",
      entity: "newsletter_settings",
      columns: ["double_opt_in"],
      useApplier: function useDoiApplier(): QuickFixApplier<EmptyPayload> {
        const qc = useQueryClient();
        const patch = usePatchNewsletterSettings("overview");
        return {
          async apply() {
            const base = await qc.fetchQuery({ ...newsletterSettingsQueryOptions(), ...FRESH });
            const saved = await patch.mutateAsync({
              base,
              draft: { ...base, double_opt_in: true },
              expectedUpdatedAt: base.updated_at ?? null,
            });
            return {
              revert: async () => {
                const after = {
                  ...base,
                  double_opt_in: true,
                  updated_at: saved.updatedAt ?? base.updated_at,
                };
                await patch.mutateAsync({
                  base: after,
                  draft: { ...after, double_opt_in: base.double_opt_in },
                  expectedUpdatedAt: saved.updatedAt ?? null,
                });
              },
            };
          },
        };
      },
    },
    reversible: true,
  },
  newsletter_sender: {
    id: "newsletter_sender",
    checkIds: ["newsletter.default_sender"],
    requiredRole: "editor",
    options: () => [
      {
        id: "own",
        labelKey: "adminRevenue.fix.newsletter_sender.option.own",
        payload: { email: "", name: "" },
      },
    ],
    diff: (_option, _facts, value) => [
      field("sender_email", key("platformSender"), text(value.email.trim())),
    ],
    valid: (value) =>
      SENDER_EMAIL_PATTERN.test(value.email.trim()) &&
      value.email.trim().toLowerCase() !== PLATFORM_SENDER,
    apply: {
      writer: "admin_newsletter_settings_patch",
      moduleExport: "usePatchNewsletterSettings",
      entity: "newsletter_settings",
      columns: ["sender_email", "sender_name"],
      useApplier: function useSenderApplier(): QuickFixApplier<SenderPayload> {
        const qc = useQueryClient();
        const patch = usePatchNewsletterSettings("overview");
        return {
          async apply(payload) {
            const base = await qc.fetchQuery({ ...newsletterSettingsQueryOptions(), ...FRESH });
            const name = payload.name.trim();
            const saved = await patch.mutateAsync({
              base,
              draft: {
                ...base,
                sender_email: payload.email.trim(),
                sender_name: name === "" ? base.sender_name : name,
              },
              expectedUpdatedAt: base.updated_at ?? null,
            });
            return {
              revert: async () => {
                const after = {
                  ...base,
                  sender_email: payload.email.trim(),
                  sender_name: name === "" ? base.sender_name : name,
                  updated_at: saved.updatedAt ?? base.updated_at,
                };
                await patch.mutateAsync({
                  base: after,
                  draft: {
                    ...after,
                    sender_email: base.sender_email,
                    sender_name: base.sender_name,
                  },
                  expectedUpdatedAt: saved.updatedAt ?? null,
                });
              },
            };
          },
        };
      },
    },
    body: fixBody(() => import("@/components/admin/revenue/diagnostics/fixes/SenderBody")),
    reversible: true,
  },
  workflow_disable: {
    id: "workflow_disable",
    checkIds: ["workflows.cancel_recipe_fires_on_pause", "workflows.overlaps_journey"],
    requiredRole: "editor",
    options: (_facts, finding) => [
      {
        id: "disable",
        labelKey: "adminRevenue.fix.workflow_disable.option.disable",
        labelParams: { count: finding.refs.length },
        payload: { workflowIds: finding.refs },
      },
    ],
    diff: () => [field("enabled", bool(true), bool(false))],
    valid: (value) => value.workflowIds.length > 0,
    apply: {
      writer: "src/lib/admin/workflowQueries.ts#useSetWorkflowEnabled",
      moduleExport: "useSetWorkflowEnabled",
      entity: "workflow",
      columns: ["enabled"],
      useApplier: function useWorkflowApplier(): QuickFixApplier<WorkflowIdsPayload> {
        const toggle = useSetWorkflowEnabled();
        return {
          async apply(payload) {
            for (const id of payload.workflowIds) await toggle.mutateAsync({ id, enabled: false });
            return {
              revert: async () => {
                for (const id of payload.workflowIds)
                  await toggle.mutateAsync({ id, enabled: true });
              },
            };
          },
        };
      },
    },
    reversible: true,
  },
};

/**
 * Specyfikacja dialogu do szkieletu `QuickFixDialog`. Ładunek jest
 * niejednorodny między dialogami (mapa `PayloadOf`), a szkielet operuje nim
 * tylko przez metody tej samej specyfikacji - stąd jedno rzutowanie tutaj
 * zamiast `any` w komponencie.
 */
export function quickFixFor(id: RevenueFixDialogId): QuickFixSpec<unknown> {
  return QUICK_FIXES[id] as unknown as QuickFixSpec<unknown>;
}

/** Dialog naprawy reguły albo `null` (naprawa linkiem, kodem albo brak). */
export function quickFixForCheck(checkId: RevenueCheckId): QuickFixSpec<unknown> | null {
  const spec = Object.values(QUICK_FIXES).find((s) =>
    (s.checkIds as readonly string[]).includes(checkId),
  );
  return spec ? (spec as unknown as QuickFixSpec<unknown>) : null;
}
