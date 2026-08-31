// Organizm: zakladka STATYSTYKI panelu reklam.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import type { AdSlot } from "@/lib/ads/types";

// Impressions / clicks / CTR per slot. Reads ad_events via the staff-read RLS
// (tenant-scoped); table not in generated types yet -> cast. A handful of slots,
// so two head-count queries per slot is cheap.
export function StatsPanel() {
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

  // Znak braku danych z klucza slownika, nie literal: pauza (U+2014) wpisana
  // wprost rozjezdzala sie z reszta panelu (dywiz ASCII), rozsypywala sie przy
  // eksporcie raportu do arkusza reklamodawcy i nie dawala sie przetlumaczyc.
  const ctr = (imp: number, clk: number) =>
    imp > 0 ? `${((clk / imp) * 100).toFixed(1)}%` : t("adsAdmin.stats.noData");

  return (
    <section className="border border-border rounded-lg bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left p-3">{t("adsAdmin.stats.columnSlot")}</th>
            <th className="text-right p-3">{t("adsAdmin.stats.impressions")}</th>
            <th className="text-right p-3">{t("adsAdmin.stats.clicks")}</th>
            <th className="text-right p-3">{t("adsAdmin.stats.columnCtr")}</th>
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
                <td className="p-3 text-right tabular-nums">{ctr(r.impressions, r.clicks)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
