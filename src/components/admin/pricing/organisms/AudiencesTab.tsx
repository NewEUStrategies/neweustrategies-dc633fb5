// Organizm: zakładka „Segmenty odbiorców" panelu Cennika 2.0.
//
// Katalog `pricing_audiences`: nazwy i tagline w obu językach, zdanie zaufania,
// ikona, kolejność, aktywność, tworzenie i usuwanie. To ten katalog decyduje,
// jakie zakładki widzi klient na `/pricing`, więc dwie reguły są tu twarde:
//   - segmentu Z PRZYPISANYMI warstwami NIE WOLNO usunąć (warstwy zostałyby
//     bez zakładki, czyli oferta zniknęłaby ze strony),
//   - zapis wymaga nazwy w OBU językach (`audienceDraftValid`).
//
// Wyniesione z pliku trasy `/admin/pricing` (1821 linii) bez zmiany zachowania.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import { EmptyHint } from "@/components/admin/pricing/atoms/EmptyHint";
import { RowOrderControls } from "@/components/admin/pricing/atoms/RowOrderControls";
import { NewAudienceDialog } from "@/components/admin/pricing/molecules/NewAudienceDialog";
import { audienceIcon } from "@/components/pricing/audienceMeta";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { billingKeys } from "@/lib/billing/keys";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow } from "@/lib/pricing/queries";
import {
  ICON_OPTIONS,
  audienceDraftValid,
  draftFromAudience,
  type AudienceDraft,
} from "@/lib/admin/pricingDrafts";
import { persistOrder } from "@/lib/admin/sortOrder";

type AudienceUpdate = Database["public"]["Tables"]["pricing_audiences"]["Update"];

export function AudiencesTab({
  audiences,
  tiers,
}: {
  audiences: PricingAudienceRow[];
  tiers: MembershipTierRow[];
}) {
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, AudienceDraft>>({});

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: billingKeys.admin.pricingAudiences() });
    void qc.invalidateQueries({ queryKey: billingKeys.pricingAudiences() });
  };

  const tiersPerAudience = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tier of tiers) {
      if (!tier.audience_key) continue;
      counts.set(tier.audience_key, (counts.get(tier.audience_key) ?? 0) + 1);
    }
    return counts;
  }, [tiers]);

  const saveAudience = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: AudienceDraft }) => {
      const patch: AudienceUpdate = {
        name_pl: draft.name_pl.trim(),
        name_en: draft.name_en.trim(),
        tagline_pl: draft.tagline_pl.trim() || null,
        tagline_en: draft.tagline_en.trim() || null,
        trust_pl: draft.trust_pl.trim() || null,
        trust_en: draft.trust_en.trim() || null,
        icon: draft.icon,
        active: draft.active,
      };
      const { error } = await supabase.from("pricing_audiences").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.audienceSaved"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createAudience = useMutation({
    mutationFn: async (input: { key: string; name_pl: string; name_en: string }) => {
      const tenantId = audiences[0]?.tenant_id ?? tiers[0]?.tenant_id;
      if (!tenantId) throw new Error(ta("toast.noTenant"));
      const maxSort = audiences.reduce((max, a) => Math.max(max, a.sort_order), 0);
      const { error } = await supabase.from("pricing_audiences").insert({
        tenant_id: tenantId,
        key: input.key,
        name_pl: input.name_pl.trim(),
        name_en: input.name_en.trim(),
        sort_order: maxSort + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.audienceCreated"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteAudience = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pricing_audiences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.audienceDeleted"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorder = useMutation({
    mutationFn: async (moved: { fromIndex: number; toIndex: number }) =>
      persistOrder(
        "pricing_audiences",
        audiences.map((a) => ({ id: a.id, sort_order: a.sort_order })),
        moved,
      ),
    onSuccess: () => {
      toast.success(ta("toast.reordered"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewAudienceDialog
          existingKeys={audiences.map((a) => a.key)}
          onCreate={(v) => createAudience.mutate(v)}
          isPending={createAudience.isPending}
        />
      </div>
      {audiences.length === 0 ? (
        <EmptyHint>{ta("audiences.empty")}</EmptyHint>
      ) : (
        audiences.map((audience, index) => {
          const draft = drafts[audience.id] ?? draftFromAudience(audience);
          const set = (patch: Partial<AudienceDraft>) =>
            setDrafts((d) => ({ ...d, [audience.id]: { ...draft, ...patch } }));
          const Icon = audienceIcon(draft.icon);
          const assigned = tiersPerAudience.get(audience.key) ?? 0;
          return (
            <Card key={audience.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate font-mono text-sm">{audience.key}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">
                      {ta("audiences.tiersCount", { count: assigned })}
                    </span>
                  </span>
                  <RowOrderControls
                    labels={{
                      moveUp: ta("audiences.moveUp"),
                      moveDown: ta("audiences.moveDown"),
                      delete: ta("audiences.deleteTitle"),
                    }}
                    canMoveUp={index > 0}
                    canMoveDown={index < audiences.length - 1}
                    pending={reorder.isPending}
                    deletePending={deleteAudience.isPending}
                    onMoveUp={() => reorder.mutate({ fromIndex: index, toIndex: index - 1 })}
                    onMoveDown={() => reorder.mutate({ fromIndex: index, toIndex: index + 1 })}
                    onDelete={() => {
                      // Segment z warstwami zostaje - usunięcie zdjęłoby ze
                      // strony cennika całą zakładkę wraz z ofertą.
                      if (assigned > 0) {
                        toast.error(ta("audiences.deleteBlocked"));
                        return;
                      }
                      if (confirm(ta("audiences.deleteConfirm", { key: audience.key }))) {
                        deleteAudience.mutate(audience.id);
                      }
                    }}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <LabeledField label={ta("audiences.namePl")}>
                    {(field) => (
                      <Input
                        {...field}
                        value={draft.name_pl}
                        onChange={(e) => set({ name_pl: e.target.value })}
                      />
                    )}
                  </LabeledField>
                  <LabeledField label={ta("audiences.nameEn")}>
                    {(field) => (
                      <Input
                        {...field}
                        value={draft.name_en}
                        onChange={(e) => set({ name_en: e.target.value })}
                      />
                    )}
                  </LabeledField>
                  <LabeledField label={ta("audiences.taglinePl")}>
                    {(field) => (
                      <Textarea
                        {...field}
                        rows={2}
                        value={draft.tagline_pl}
                        onChange={(e) => set({ tagline_pl: e.target.value })}
                      />
                    )}
                  </LabeledField>
                  <LabeledField label={ta("audiences.taglineEn")}>
                    {(field) => (
                      <Textarea
                        {...field}
                        rows={2}
                        value={draft.tagline_en}
                        onChange={(e) => set({ tagline_en: e.target.value })}
                      />
                    )}
                  </LabeledField>
                  <LabeledField label={ta("audiences.trustPl")} hint={ta("audiences.trustHint")}>
                    {(field) => (
                      <Input
                        {...field}
                        value={draft.trust_pl}
                        onChange={(e) => set({ trust_pl: e.target.value })}
                        placeholder="Faktura · Umowa roczna · Wdrożenie z opiekunem"
                      />
                    )}
                  </LabeledField>
                  <LabeledField label={ta("audiences.trustEn")}>
                    {(field) => (
                      <Input
                        {...field}
                        value={draft.trust_en}
                        onChange={(e) => set({ trust_en: e.target.value })}
                        placeholder="Invoice · Annual agreement · Guided onboarding"
                      />
                    )}
                  </LabeledField>
                </div>
                <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3">
                  <LabeledField label={ta("audiences.icon")}>
                    {(field) => (
                      <Select value={draft.icon} onValueChange={(v) => set({ icon: v })}>
                        <SelectTrigger {...field}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ICON_OPTIONS.map((slug) => (
                            <SelectItem key={slug} value={slug}>
                              {ta(`icons.${slug}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </LabeledField>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                    <span className="text-xs">{ta("audiences.active")}</span>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={saveAudience.isPending || !audienceDraftValid(draft)}
                      onClick={() => saveAudience.mutate({ id: audience.id, draft })}
                    >
                      <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {ta("audiences.save")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
