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
// Wyniesione z pliku trasy `/admin/membership` (898 linii) bez zmiany zachowania.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Settings2, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloatingInput } from "@/components/ui/floating-input";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import { FieldGroupRule } from "@/components/admin/membership/atoms/FieldGroupRule";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import {
  fetchMembershipGrants,
  grantMembership,
  revokeGrant,
  type AdminGrantRow,
} from "@/lib/admin/membership-admin";
import { billingKeys } from "@/lib/billing/keys";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import { uiLocale } from "@/lib/i18n/format";

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

  const grantsQ = useQuery({
    queryKey: billingKeys.admin.membershipGrants(),
    queryFn: fetchMembershipGrants,
  });

  const [email, setEmail] = useState("");
  const [tierKey, setTierKey] = useState("");
  const [months, setMonths] = useState("12");
  const [note, setNote] = useState("");

  const grantM = useMutation({
    mutationFn: () =>
      grantMembership({
        email: email.trim(),
        tierKey,
        months: months.trim() === "" ? null : Number(months),
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success(tm("toast.grantSuccess"));
      setEmail("");
      setNote("");
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipGrants() });
    },
    onError: (e: Error) => {
      const msg = e.message || "";
      if (msg.includes("user not found")) toast.error(tm("toast.noAccount"));
      else if (msg.includes("tier not found")) toast.error(tm("toast.unknownTier"));
      else toast.error(msg);
    },
  });

  const revokeM = useMutation({
    mutationFn: (id: string) => revokeGrant(id),
    onSuccess: () => {
      toast.success(tm("toast.grantRevoked"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipGrants() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canGrant = /.+@.+\..+/.test(email.trim()) && tierKey !== "";
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
          onClick={() => revokeM.mutate(g.id)}
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
                <Select value={tierKey} onValueChange={setTierKey}>
                  <SelectTrigger {...field}>
                    <SelectValue placeholder={tm("grants.tierSelect")} />
                  </SelectTrigger>
                  <SelectContent>
                    {tierOptions.map((tier) => (
                      <SelectItem key={tier.key} value={tier.key}>
                        {tier.key} ({lang === "pl" ? tier.name_pl : tier.name_en})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </LabeledField>
            <LabeledField label={tm("grants.months")} className="space-y-1">
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  min={1}
                  max={120}
                  value={months}
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
