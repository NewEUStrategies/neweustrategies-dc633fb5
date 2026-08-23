// Organizm: zakładka "Rozmieszczenie" panelu reklam.
//
// PRZENIESIONE ZNAK W ZNAK RAZEM Z WADĄ: `load()` czyta DWIE tabele przez
// `Promise.all` i NIE czyta pola `error` z żadnej z nich. Odmowa RLS albo
// awaria odczytu daje więc pustą tabelę z napisem "Brak pozycji." - administrator
// nie odróżni "nic nie ma" od "nie udało się przeczytać". Zakładka slotów robi
// to poprawnie (`if (error) toast.error(...)`), ta nie. Zgłoszone przez
// `it.fails`, naprawa idzie osobnym krokiem.
//
// Dialog usunięcia pozycji - w odróżnieniu od dialogu slotu - NIE MA `description`
// (słownik nie ma nawet takiego klucza), więc administrator nie dowiaduje się,
// co znika.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { AdPlacement, AdSlot } from "@/lib/ads/types";
import { adminToast } from "@/lib/adminToasts";
import { confirmDialog } from "@/lib/appDialogs";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdPlacementRow } from "../molecules/AdPlacementRow";
import { AdTableEmptyRow } from "../molecules/AdTableEmptyRow";
import { AdPlacementForm } from "./AdPlacementForm";

/** Świeży draft pozycji: aktywna, na wpisach, nad treścią, bez konfiguracji. */
export function emptyPlacement(): Partial<AdPlacement> {
  return {
    slot_id: "",
    position: "top_of_post",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
  };
}

export function AdPlacementsPanel() {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [draft, setDraft] = useState<Partial<AdPlacement>>(emptyPlacement());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("ad_slots").select("*").order("name"),
      supabase.from("ad_placements").select("*").order("sort_order"),
    ]);
    setSlots((s as AdSlot[]) ?? []);
    setPlacements((p as AdPlacement[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const slotMap = useMemo(() => Object.fromEntries(slots.map((s) => [s.id, s])), [slots]);

  const save = async () => {
    if (!draft.slot_id) {
      toast.error("Wybierz slot");
      return;
    }
    setBusy(true);
    const payload = { ...draft } as never;
    const { error } = draft.id
      ? await supabase.from("ad_placements").update(payload).eq("id", draft.id)
      : await supabase.from("ad_placements").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.saved());
      setDraft(emptyPlacement());
      load();
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: t("adsAdmin.placements.deleteTitle"),
        destructive: true,
        confirmLabel: t("adsAdmin.deleteConfirm"),
      }))
    )
      return;
    const { error } = await supabase.from("ad_placements").delete().eq("id", id);
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
              <th className="text-left p-3">Slot</th>
              <th className="text-left p-3">Pozycja</th>
              <th className="text-left p-3">Strony</th>
              <th className="text-left p-3">Aktywne</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => (
              <AdPlacementRow
                key={p.id}
                placement={p}
                slotName={slotMap[p.slot_id]?.name}
                onEdit={(next) => setDraft(next)}
                onDelete={remove}
                editLabel="Edytuj"
              />
            ))}
            {placements.length === 0 && (
              <AdTableEmptyRow colSpan={5}>Brak pozycji.</AdTableEmptyRow>
            )}
          </tbody>
        </table>
      </section>

      <AdPlacementForm
        draft={draft}
        slots={slots}
        onChange={setDraft}
        onSubmit={save}
        onCancel={() => setDraft(emptyPlacement())}
        busy={busy}
      />
    </div>
  );
}
