// Molekuła: katalog powodów rezygnacji.
//
// Ta lista jest podpowiedziami na ekranie rezygnacji, więc jej kolejność i
// treść wprost kształtują to, co klient wybierze - a potem statystyki, na
// których redakcja opiera zmiany w ofercie. Dwa warunki są twarde: nowy powód
// i zapis wymagają etykiety w OBU językach (jednojęzyczna zniknęłaby w drugiej
// wersji ekranu), a wyłączony powód przestaje się pokazywać, ale nie znika z
// historii odpowiedzi.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RowOrderControls } from "@/components/admin/pricing/atoms/RowOrderControls";
import { reasonDraftFromRow, type ReasonDraft } from "@/lib/admin/pricingDrafts";
import type { RetentionReasonRow } from "@/lib/retention/queries";

export function RetentionReasonsEditor({
  reasons,
  addPending,
  savePending,
  deletePending,
  reorderPending,
  onAdd,
  onSave,
  onDelete,
  onReorder,
}: {
  reasons: RetentionReasonRow[];
  addPending: boolean;
  savePending: boolean;
  deletePending: boolean;
  reorderPending: boolean;
  /** Musi ODRZUCIĆ obietnicę przy błędzie - inaczej pola wyczyszczą się po nieudanym zapisie. */
  onAdd: (labels: { label_pl: string; label_en: string }) => Promise<unknown>;
  onSave: (id: string, value: ReasonDraft) => void;
  onDelete: (id: string) => void;
  onReorder: (moved: { fromIndex: number; toIndex: number }) => void;
}) {
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, ReasonDraft>>({});
  const [newReasonPl, setNewReasonPl] = useState("");
  const [newReasonEn, setNewReasonEn] = useState("");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{ta("retention.reasonsHeading")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label className="text-xs">{ta("retention.reasonPl")}</Label>
            <Input value={newReasonPl} onChange={(e) => setNewReasonPl(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{ta("retention.reasonEn")}</Label>
            <Input value={newReasonEn} onChange={(e) => setNewReasonEn(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={addPending || !newReasonPl.trim() || !newReasonEn.trim()}
            onClick={() => {
              // Pola czyścimy TYLKO po udanym zapisie. Gdy baza odmówi, wpisany
              // tekst musi zostać na ekranie - o błędzie mówi toast z mutacji,
              // a redakcja ma poprawić literówkę, nie pisać powód od nowa.
              void onAdd({ label_pl: newReasonPl, label_en: newReasonEn })
                .then(() => {
                  setNewReasonPl("");
                  setNewReasonEn("");
                })
                .catch(() => {});
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {ta("retention.addReason")}
          </Button>
        </div>
        <div className="space-y-2">
          {reasons.map((reason, index) => {
            const value = reasonDrafts[reason.id] ?? reasonDraftFromRow(reason);
            const set = (patch: Partial<ReasonDraft>) =>
              setReasonDrafts((d) => ({ ...d, [reason.id]: { ...value, ...patch } }));
            return (
              <div
                key={reason.id}
                className="grid grid-cols-1 items-center gap-2 rounded-md border border-border/60 p-2 sm:grid-cols-[1fr_1fr_auto_auto]"
              >
                <Input
                  value={value.label_pl}
                  onChange={(e) => set({ label_pl: e.target.value })}
                  className="h-8 text-sm"
                />
                <Input
                  value={value.label_en}
                  onChange={(e) => set({ label_en: e.target.value })}
                  className="h-8 text-sm"
                />
                <label className="flex items-center gap-2 px-1">
                  <Switch checked={value.active} onCheckedChange={(v) => set({ active: v })} />
                  <span className="text-xs">{ta("retention.reasonActive")}</span>
                </label>
                <div className="flex items-center gap-0.5">
                  <RowOrderControls
                    labels={{
                      moveUp: ta("retention.moveUp"),
                      moveDown: ta("retention.moveDown"),
                      delete: ta("retention.reasonDelete"),
                    }}
                    canMoveUp={index > 0}
                    canMoveDown={index < reasons.length - 1}
                    pending={reorderPending}
                    deletePending={deletePending}
                    onMoveUp={() => onReorder({ fromIndex: index, toIndex: index - 1 })}
                    onMoveDown={() => onReorder({ fromIndex: index, toIndex: index + 1 })}
                    onDelete={() => {
                      if (confirm(ta("retention.reasonDeleteConfirm"))) onDelete(reason.id);
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => onSave(reason.id, value)}
                    disabled={savePending || !value.label_pl.trim() || !value.label_en.trim()}
                    aria-label={ta("retention.save")}
                    title={ta("retention.save")}
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
