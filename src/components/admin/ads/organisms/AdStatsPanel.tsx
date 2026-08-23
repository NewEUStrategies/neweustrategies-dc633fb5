// Organizm: zakładka "Statystyki" panelu reklam.
//
// Impressions / clicks / CTR per slot. Czyta `ad_events` przez RLS dla redakcji
// (zakres najemcy); tabela nie jest jeszcze w generowanych typach -> rzutowanie.
// Slotów jest garść, więc dwa zapytania liczące na slot są tanie.
//
// PRZENIESIONE ZNAK W ZNAK RAZEM Z WADĄ: pole `error` odczytu slotów NIE jest
// czytane, więc odmowa RLS pokazuje "Brak danych." - dokładnie to samo, co slot
// z zerem zdarzeń. Zgłoszone przez `it.fails`.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { AdSlot } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdCtrCell } from "../atoms/AdCtrCell";

export function AdStatsPanel() {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ slot: AdSlot; impressions: number; clicks: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("ad_slots").select("*").order("name");
      const slots = (data as AdSlot[]) ?? [];
      const withCounts = await Promise.all(
        slots.map(async (s) => {
          const [{ count: imp }, { count: clk }] = await Promise.all([
            supabase
              .from("ad_events")
              .select("*", { count: "exact", head: true })
              .eq("slot_id", s.id)
              .eq("kind", "impression"),
            supabase
              .from("ad_events")
              .select("*", { count: "exact", head: true })
              .eq("slot_id", s.id)
              .eq("kind", "click"),
          ]);
          return { slot: s, impressions: imp ?? 0, clicks: clk ?? 0 };
        }),
      );
      if (!cancelled) {
        setRows(withCounts);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="border border-border rounded-lg bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left p-3">Slot</th>
            <th className="text-right p-3">{t("adsAdmin.stats.impressions")}</th>
            <th className="text-right p-3">{t("adsAdmin.stats.clicks")}</th>
            <th className="text-right p-3">CTR</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={4} className="p-6 text-center text-muted-foreground">
                {t("adsAdmin.stats.loading")}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-6 text-center text-muted-foreground">
                {t("adsAdmin.stats.empty")}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.slot.id} className="border-b border-border">
                <td className="p-3 font-medium">{r.slot.name}</td>
                <td className="p-3 text-right tabular-nums">{r.impressions}</td>
                <td className="p-3 text-right tabular-nums">{r.clicks}</td>
                <AdCtrCell impressions={r.impressions} clicks={r.clicks} />
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
