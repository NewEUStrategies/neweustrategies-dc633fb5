// Organizm: zakładka "Sloty" panelu reklam.
//
// To JEDYNE miejsce rodziny `ads`, które zna `supabase.from` dla slotów - i to
// jedyne, którego test potrzebuje atrapy klienta. Trzy decyzje mieszkają tutaj,
// nie w formularzu:
//   1. nowy slot startuje z `requires_consent: true` (patrz `emptySlot`),
//   2. usunięcie idzie za `confirmDialog` z treścią skutku,
//   3. awaria odczytu listy JEST pokazywana (tego samego nie robi zakładka
//      pozycji ani statystyk - patrz ich nagłówki).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { AdSlot } from "@/lib/ads/types";
import { adminToast } from "@/lib/adminToasts";
import { confirmDialog } from "@/lib/appDialogs";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdTargetingHeader } from "../atoms/AdTargetingSummary";
import { AdSlotRow } from "../molecules/AdSlotRow";
import { AdTableEmptyRow } from "../molecules/AdTableEmptyRow";
import { AdSlotForm } from "./AdSlotForm";

/**
 * Świeży draft slotu. `requires_consent: true` jest DECYZJĄ RODO, nie
 * wartością techniczną: slot bez zgody ładuje skrypt strony trzeciej
 * czytelnikowi, który zgody nie wyraził, więc utworzenie slotu nie może
 * startować z `false`. Kolumna w bazie ma ten sam domyślny
 * (`requires_consent boolean NOT NULL DEFAULT true`).
 */
export function emptySlot(): Partial<AdSlot> {
  return {
    name: "",
    kind: "html",
    status: "active",
    requires_consent: true,
    html: "",
    script: "",
    image_url: "",
    image_link: "",
    image_alt: "",
    width: null,
    height: null,
    notes: "",
  };
}

export function AdSlotsPanel() {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [draft, setDraft] = useState<Partial<AdSlot>>(emptySlot());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("ad_slots")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setSlots((data as AdSlot[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!draft.name?.trim()) {
      toast.error(t("adsAdmin.slots.nameRequired"));
      return;
    }
    setBusy(true);
    const payload = { ...draft } as never;
    const { error } = draft.id
      ? await supabase.from("ad_slots").update(payload).eq("id", draft.id)
      : await supabase.from("ad_slots").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Zapisano slot");
      setDraft(emptySlot());
      load();
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: t("adsAdmin.slots.deleteTitle"),
        description: t("adsAdmin.slots.deleteBody"),
        destructive: true,
        confirmLabel: t("adsAdmin.deleteConfirm"),
      }))
    )
      return;
    const { error } = await supabase.from("ad_slots").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.deleted());
      load();
    }
  };

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-3">{t("adsAdmin.slots.columnName")}</th>
              <th className="text-left p-3">{t("adsAdmin.slots.columnKind")}</th>
              <th className="text-left p-3">{t("adsAdmin.slots.columnStatus")}</th>
              <th className="text-left p-3">{t("adsAdmin.slots.columnConsent")}</th>
              <th className="text-left p-3">
                <AdTargetingHeader />
              </th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <AdSlotRow
                key={s.id}
                slot={s}
                onEdit={(next) => setDraft(next)}
                onDelete={remove}
                editLabel="Edytuj"
              />
            ))}
            {slots.length === 0 && (
              <AdTableEmptyRow colSpan={6}>Brak slotów. Dodaj pierwszy poniżej.</AdTableEmptyRow>
            )}
          </tbody>
        </table>
      </section>

      <AdSlotForm
        draft={draft}
        onChange={setDraft}
        onSubmit={save}
        onCancel={() => setDraft(emptySlot())}
        busy={busy}
      />
    </div>
  );
}
