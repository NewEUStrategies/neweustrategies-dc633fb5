// Organizm: zakładka „FAQ cennika" panelu Cennika 2.0.
//
// Pytania z `pricing_faq_items`: globalne albo przypisane do segmentu, z pełną
// parą językową, kolejnością i aktywnością. Reguła zapisu (`faqDraftValid`)
// wymaga pytania I odpowiedzi w OBU językach - połowiczne pytanie zniknęłoby
// w jednej z wersji strony, na której klient wybiera plan.
//
// Wyniesione z pliku trasy `/admin/pricing` (1821 linii) bez zmiany zachowania.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyHint } from "@/components/admin/pricing/atoms/EmptyHint";
import { RowOrderControls } from "@/components/admin/pricing/atoms/RowOrderControls";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { billingKeys } from "@/lib/billing/keys";
import type { PricingAudienceRow, PricingFaqItemRow } from "@/lib/pricing/queries";
import {
  EMPTY_FAQ_DRAFT,
  GLOBAL_FAQ,
  draftFromFaq,
  faqAudienceColumn,
  faqDraftValid,
  type FaqDraft,
} from "@/lib/admin/pricingDrafts";
import { persistOrder } from "@/lib/admin/sortOrder";

type FaqUpdate = Database["public"]["Tables"]["pricing_faq_items"]["Update"];

export function FaqTab({
  audiences,
  items,
}: {
  audiences: PricingAudienceRow[];
  items: PricingFaqItemRow[];
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, FaqDraft>>({});
  const [newDraft, setNewDraft] = useState<FaqDraft>(EMPTY_FAQ_DRAFT);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: billingKeys.admin.pricingFaq() });
    void qc.invalidateQueries({ queryKey: billingKeys.pricingFaq() });
  };

  const addFaq = useMutation({
    mutationFn: async (draft: FaqDraft) => {
      const tenantId = items[0]?.tenant_id ?? audiences[0]?.tenant_id;
      if (!tenantId) throw new Error(ta("toast.noTenant"));
      const maxSort = items.reduce((max, item) => Math.max(max, item.sort_order), 0);
      const { error } = await supabase.from("pricing_faq_items").insert({
        tenant_id: tenantId,
        audience_key: faqAudienceColumn(draft.audience_key),
        question_pl: draft.question_pl.trim(),
        question_en: draft.question_en.trim(),
        answer_pl: draft.answer_pl.trim(),
        answer_en: draft.answer_en.trim(),
        sort_order: maxSort + 10,
        active: draft.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.faqAdded"));
      setNewDraft(EMPTY_FAQ_DRAFT);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveFaq = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: FaqDraft }) => {
      const patch: FaqUpdate = {
        audience_key: faqAudienceColumn(draft.audience_key),
        question_pl: draft.question_pl.trim(),
        question_en: draft.question_en.trim(),
        answer_pl: draft.answer_pl.trim(),
        answer_en: draft.answer_en.trim(),
        active: draft.active,
      };
      const { error } = await supabase.from("pricing_faq_items").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.faqSaved"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteFaq = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pricing_faq_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(ta("toast.faqDeleted"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reorder = useMutation({
    mutationFn: async (moved: { fromIndex: number; toIndex: number }) =>
      persistOrder(
        "pricing_faq_items",
        items.map((item) => ({ id: item.id, sort_order: item.sort_order })),
        moved,
      ),
    onSuccess: () => {
      toast.success(ta("toast.reordered"));
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const audienceSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={GLOBAL_FAQ}>{ta("faq.global")}</SelectItem>
        {audiences.map((audience) => (
          <SelectItem key={audience.key} value={audience.key}>
            {audience.key} ({lang === "en" ? audience.name_en : audience.name_pl})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const faqFields = (draft: FaqDraft, set: (patch: Partial<FaqDraft>) => void) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div>
        <Label className="text-xs">{ta("faq.questionPl")}</Label>
        <Input value={draft.question_pl} onChange={(e) => set({ question_pl: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">{ta("faq.questionEn")}</Label>
        <Input value={draft.question_en} onChange={(e) => set({ question_en: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">{ta("faq.answerPl")}</Label>
        <Textarea
          rows={3}
          value={draft.answer_pl}
          onChange={(e) => set({ answer_pl: e.target.value })}
        />
      </div>
      <div>
        <Label className="text-xs">{ta("faq.answerEn")}</Label>
        <Textarea
          rows={3}
          value={draft.answer_en}
          onChange={(e) => set({ answer_en: e.target.value })}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{ta("faq.newHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {faqFields(newDraft, (patch) => setNewDraft((d) => ({ ...d, ...patch })))}
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">{ta("faq.audience")}</Label>
              {audienceSelect(newDraft.audience_key, (v) =>
                setNewDraft((d) => ({ ...d, audience_key: v })),
              )}
            </div>
            <div className="sm:col-span-2">
              <Button
                size="sm"
                disabled={addFaq.isPending || !faqDraftValid(newDraft)}
                onClick={() => addFaq.mutate(newDraft)}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {ta("faq.add")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyHint>{ta("faq.empty")}</EmptyHint>
      ) : (
        items.map((item, index) => {
          const draft = drafts[item.id] ?? draftFromFaq(item);
          const set = (patch: Partial<FaqDraft>) =>
            setDrafts((d) => ({ ...d, [item.id]: { ...draft, ...patch } }));
          return (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {lang === "en" ? draft.question_en : draft.question_pl}
                  </span>
                  <RowOrderControls
                    labels={{
                      moveUp: ta("faq.moveUp"),
                      moveDown: ta("faq.moveDown"),
                      delete: ta("faq.deleteTitle"),
                    }}
                    canMoveUp={index > 0}
                    canMoveDown={index < items.length - 1}
                    pending={reorder.isPending}
                    deletePending={deleteFaq.isPending}
                    onMoveUp={() => reorder.mutate({ fromIndex: index, toIndex: index - 1 })}
                    onMoveDown={() => reorder.mutate({ fromIndex: index, toIndex: index + 1 })}
                    onDelete={() => {
                      if (confirm(ta("faq.deleteConfirm"))) deleteFaq.mutate(item.id);
                    }}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {faqFields(draft, set)}
                <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">{ta("faq.audience")}</Label>
                    {audienceSelect(draft.audience_key, (v) => set({ audience_key: v }))}
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                    <span className="text-xs">{ta("faq.active")}</span>
                  </div>
                  <div>
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={saveFaq.isPending || !faqDraftValid(draft)}
                      onClick={() => saveFaq.mutate({ id: item.id, draft })}
                    >
                      <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {ta("faq.save")}
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
