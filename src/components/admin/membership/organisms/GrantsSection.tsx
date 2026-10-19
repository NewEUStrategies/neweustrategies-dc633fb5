// Organizm: nadania warstwy POZA planem (`membership_grants`).
//
// Tą drogą członkostwo dostaje ktoś, kto nie kupił subskrypcji: darczyńca,
// klient fakturowy, gość honorowy, import z poprzedniego systemu. Dwie rzeczy
// mają tu znaczenie dla pieniędzy i dla zaufania:
//
//   WYGAŚNIĘCIE. Puste pole „miesiące" znaczy nadanie BEZ KOŃCA - dostęp na
//   zawsze, bez żadnej płatności. Podpowiedź przy polu mówi to wprost, bo
//   pomyłka w tę stronę jest nieodwracalna po cichu.
//
//   ODWOŁANIE. Odwołane nadanie NIE ZNIKA z listy - schodzi do sekcji
//   „odwołane". Historia dostępu musi zostać czytelna po fakcie: kto miał
//   dostęp, na jakiej podstawie i do kiedy.
//
// JEDNA ŚCIEŻKA NADAŃ (S1 def. 6, D-S1-09). Dawne `admin_grant_membership`
// szukało e-maila GLOBALNIE w `auth.users` (bez sprawdzenia organizacji), nie
// wygaszało poprzedniego nadania i nie zostawiało audytu. Teraz:
//   1. adres rozwiązujemy w katalogu członków ORGANIZACJI
//      (`findTenantMemberByEmail`, najemca z sesji) - konto spoza organizacji to
//      komunikat dla admina, a nie wyjątek SQL;
//   2. nadanie i cofnięcie idą RPC `admin_membership_grant_set|revoke`, które
//      w jednej transakcji wygaszają ręczne nadania tej osoby, piszą audyt
//      i outbox CRM (to samo RPC woła katalog członków - `setMemberTier`);
//   3. cofnięcie pyta o opcjonalny powód - trafia do audytu, bo „kto zabrał
//      dostęp i dlaczego" jest pytaniem, które ktoś zada po fakcie.
// Po sukcesie odświeżamy WSZYSTKICH czytelników warstwy osoby: listę nadań,
// katalog członków, rozliczenia członka, pulpit monetyzacji, „moje nadania"
// i bieżącą warstwę czytelnika oraz kluby (dostęp do klubu zależy od warstwy).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Settings2, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloatingInput } from "@/components/ui/floating-input";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/atoms/FormSelect";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import { FieldGroupRule } from "@/components/admin/membership/atoms/FieldGroupRule";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { adminMembershipGrantsQueryOptions } from "@/components/admin/membership/grantsQuery";
import { promptDialog } from "@/lib/appDialogs";
import {
  findTenantMemberByEmail,
  revokeMembershipGrant,
  setMembershipGrant,
  type AdminGrantRow,
} from "@/lib/admin/membership-admin";
import { addCalendarMonthsUtc } from "@/lib/admin/membersDirectory.functions";
import { billingKeys } from "@/lib/billing/keys";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { uiLocale } from "@/lib/i18n/format";
import { toastError } from "@/lib/toastError";

/** Najdłuższe nadanie terminowe (10 lat) - dłuższe to w praktyce bezterminowe. */
const GRANT_MONTHS_MAX = 120;

/** Czytelnicy warstwy osoby - unieważniani po nadaniu i cofnięciu. */
const GRANT_READER_KEYS = [
  billingKeys.admin.membershipGrants(),
  billingKeys.admin.members(),
  billingKeys.admin.memberBillingAll(),
  billingKeys.admin.monetization(),
  billingKeys.myGrantsAll(),
  billingKeys.currentTierAll(),
  clubKeys.all,
] as const;

/**
 * Kod maszynowy błędu RPC nadań (`tier_inactive`, `user_not_in_tenant`…).
 * Funkcje SQL S1 podnoszą wyjątek z komunikatem = kodem (PLAN S1 §4.1), więc
 * szukamy go w treści, a nie zgadujemy po SQLSTATE (22023 ma kilka powodów).
 */
function grantErrorCode(err: unknown): string | null {
  const message =
    typeof err === "object" &&
    err !== null &&
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  for (const code of [
    "tier_inactive",
    "user_not_in_tenant",
    "expires_in_past",
    "grant_not_found",
  ]) {
    if (message.includes(code)) return code;
  }
  return null;
}

/** Liczba miesięcy z pola: `null` = bezterminowo (puste), `NaN` = niepoprawna. */
function parseMonths(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= GRANT_MONTHS_MAX ? value : Number.NaN;
}

export function GrantsSection({
  lang,
  tierOptions,
}: {
  lang: "pl" | "en";
  tierOptions: MembershipTierRow[];
}) {
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const qc = useQueryClient();

  const grantsQ = useQuery(adminMembershipGrantsQueryOptions());

  const [email, setEmail] = useState("");
  const [tierKey, setTierKey] = useState("");
  const [months, setMonths] = useState("12");
  const [note, setNote] = useState("");

  const refreshReaders = () =>
    Promise.all(GRANT_READER_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));

  const grantM = useMutation({
    mutationFn: async (): Promise<"granted" | "no_account"> => {
      const member = await findTenantMemberByEmail(email);
      // Brak konta w TEJ organizacji to odpowiedź, nie awaria: admin ma
      // poprawić adres albo zaprosić osobę - a nie czytać wyjątku SQL.
      if (!member) return "no_account";
      const length = parseMonths(months);
      await setMembershipGrant({
        userId: member.userId,
        tierKey,
        // Miesiące kalendarzowe w UTC (31 stycznia + 1 = 28/29 lutego), ta sama
        // reguła co katalog członków - dwie ścieżki nie mogą liczyć terminu inaczej.
        expiresAt: length === null ? null : addCalendarMonthsUtc(new Date(), length).toISOString(),
        note: note.trim() || null,
      });
      return "granted";
    },
    onSuccess: async (result) => {
      if (result === "no_account") {
        toast.error(tm("toast.noAccount"));
        return;
      }
      toast.success(tm("toast.grantSuccess"));
      setEmail("");
      setNote("");
      await refreshReaders();
    },
    onError: (err: unknown) => {
      const code = grantErrorCode(err);
      if (code === "user_not_in_tenant") toast.error(tm("toast.noAccount"));
      else if (code === "tier_inactive") toast.error(tm("toast.tierInactive"));
      else if (code === "expires_in_past") toast.error(tm("toast.expiresInPast"));
      else toastError(err, "save");
    },
  });

  const revokeM = useMutation({
    mutationFn: (input: { grantId: string; reason: string | null }) => revokeMembershipGrant(input),
    onSuccess: async () => {
      toast.success(tm("toast.grantRevoked"));
      await refreshReaders();
    },
    onError: (err: unknown) => {
      // Nadanie cofnięte w innej karcie - lista na ekranie jest nieaktualna.
      if (grantErrorCode(err) === "grant_not_found") {
        toast.error(tm("toast.grantGone"));
        void grantsQ.refetch();
        return;
      }
      toastError(err, "delete");
    },
  });

  const askRevoke = async (grant: AdminGrantRow) => {
    const reason = await promptDialog({
      title: tm("grants.revokeTitle", { tier: grant.tier_key, email: grant.email }),
      description: tm("grants.revokeDescription"),
      label: tm("grants.revokeReason"),
      placeholder: tm("grants.revokeReasonPlaceholder"),
      confirmLabel: tm("grants.revokeConfirm"),
    });
    // `null` = anulowane; pusty napis = cofnięcie bez powodu (powód jest opcjonalny).
    if (reason === null) return;
    revokeM.mutate({ grantId: grant.id, reason: reason.trim() || null });
  };

  const monthsValue = parseMonths(months);
  const canGrant =
    /.+@.+\..+/.test(email.trim()) && tierKey !== "" && !Number.isNaN(monthsValue ?? 0);
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(uiLocale(lang)) : "—";
  const sourceLabel = (s: string) =>
    s === "donation"
      ? tm("grants.sourceDonation")
      : s === "import"
        ? tm("grants.sourceImport")
        : tm("grants.sourceManual");

  const activeGrants = (grantsQ.data ?? []).filter((g) => !g.revoked_at);
  const revokedGrants = (grantsQ.data ?? []).filter((g) => g.revoked_at);

  const renderRow = (g: AdminGrantRow) => (
    <div
      key={g.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {g.display_name ? `${g.display_name} · ` : ""}
          {g.email}
        </div>
        <div className="text-xs text-muted-foreground">
          {g.tier_key} · {sourceLabel(g.source)} ·{" "}
          {g.expires_at ? `${tm("grants.until")} ${fmtDate(g.expires_at)}` : tm("grants.noExpiry")}
          {g.revoked_at ? ` · ${tm("grants.revoked")}` : ""}
        </div>
      </div>
      {!g.revoked_at && (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={revokeM.isPending}
          onClick={() => void askRevoke(g)}
        >
          <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
          {tm("grants.revoke")}
        </Button>
      )}
    </div>
  );

  return (
    <>
      <SectionCard icon={Plus} title={tm("grants.newHeading")} description={tm("grants.hint")}>
        <FieldGroupRule label={tm("groups.grantForm")}>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-end">
            <LabeledField label={tm("grants.email")} className="space-y-1">
              {(field) => (
                <Input
                  {...field}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="osoba@instytucja.eu"
                />
              )}
            </LabeledField>
            <LabeledField label={tm("grants.tier")} className="space-y-1">
              {(field) => (
                <FormSelect
                  id={field.id}
                  value={tierKey}
                  onValueChange={setTierKey}
                  placeholder={tm("grants.tierSelect")}
                  options={tierOptions.map((tier) => ({
                    value: tier.key,
                    label: `${tier.key} (${lang === "pl" ? tier.name_pl : tier.name_en})`,
                  }))}
                />
              )}
            </LabeledField>
            <LabeledField label={tm("grants.months")} className="space-y-1">
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  min={1}
                  max={GRANT_MONTHS_MAX}
                  value={months}
                  aria-invalid={Number.isNaN(monthsValue ?? 0) || undefined}
                  onChange={(e) => setMonths(e.target.value)}
                  placeholder="∞"
                />
              )}
            </LabeledField>
            <Button disabled={!canGrant || grantM.isPending} onClick={() => grantM.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {tm("grants.grant")}
            </Button>
            <div className="sm:col-span-4">
              <FloatingInput
                label={tm("grants.note")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        </FieldGroupRule>
      </SectionCard>

      <SectionCard
        icon={Users}
        title={tm("grants.activeHeading")}
        description={tm("grants.activeHint")}
      >
        {activeGrants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tm("grants.empty")}</p>
        ) : (
          <div className="space-y-2">{activeGrants.map(renderRow)}</div>
        )}
      </SectionCard>

      {revokedGrants.length > 0 && (
        <SectionCard
          icon={Settings2}
          title={tm("grants.revokedHeading")}
          description={tm("grants.revokedHint")}
        >
          <div className="space-y-2 opacity-70">{revokedGrants.map(renderRow)}</div>
        </SectionCard>
      )}
    </>
  );
}
