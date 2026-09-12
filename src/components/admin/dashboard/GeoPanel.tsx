// MAPA POCHODZENIA - "skąd pochodzi ruch i skąd są pozyskani ludzie".
//
// DWA ŹRÓDŁA, BO TO SĄ DWA RÓŻNE PYTANIA i mylenie ich jest łatwe.
// "Ruch" to kraj przeglądarki z nagłówka warstwy brzegowej: mówi, skąd nas
// CZYTAJĄ. "Kontakty CRM" to pole kraju na rekordzie: mówi, skąd są ludzie,
// z którymi coś nas ŁĄCZY. Te zbiory nie muszą się pokrywać i różnica między
// nimi jest samodzielną informacją handlową - stąd przełącznik, a nie dwie
// liczby zsumowane w jedną mapę.
//
// RYSUJE `ChoroplethMap`, czyli ten sam silnik map, co blok danych we wpisie
// i widget buildera. Geometria nie jedzie w bundlu - leży w public/geo/*.json
// i jest dociągana fetchem (patrz nagłówek `ChoroplethMap.tsx`), więc pulpit
// nie płaci za mapę, dopóki jej nie pokaże.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";
import { chartLangFrom } from "@/lib/charts/format";
import type { DataMapConfig, MapRegion } from "@/lib/charts/types";
import { countryNamer } from "@/lib/admin/dashboard/labels";
import { formatCount } from "@/lib/admin/dashboard/compare";
import { RankedList } from "./RankedList";

export interface GeoPanelProps {
  /** Kraje ruchu: kod ISO-2 + liczba sesji. */
  traffic: { code: string; sessions: number }[];
  /** Kraje kontaktów CRM: kod ISO-2 + liczba rekordów. */
  leads: { code: string; leads: number }[];
}

type GeoSource = "traffic" | "leads";

/** Regiony oferowane na pulpicie - pełna lista `MAP_REGIONS` jest w edytorze bloku. */
const REGIONS: readonly Extract<MapRegion, "europe" | "world">[] = ["europe", "world"];

export function GeoPanel({ traffic, leads }: GeoPanelProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const nameOf = useMemo(() => countryNamer(lang), [lang]);

  // Domyślnie ŚWIAT, a nie Europa. Mapa Europy ucina kraje spoza niej bez
  // słowa, więc pulpit, który startuje od niej, potrafi zataić, że jedna
  // trzecia ruchu przychodzi z Ameryki - a to jest dokładnie ta informacja,
  // dla której się na mapę patrzy.
  const [region, setRegion] = useState<MapRegion>("world");
  const [source, setSource] = useState<GeoSource>("traffic");

  const rows = useMemo(
    () =>
      source === "traffic"
        ? traffic.map((c) => ({ code: c.code, value: c.sessions }))
        : leads.map((c) => ({ code: c.code, value: c.leads })),
    [source, traffic, leads],
  );

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  const config = useMemo<DataMapConfig>(
    () => ({
      region,
      // Tytuł i opis puste: nagłówek rysuje karta sekcji, a rama silnika pomija
      // swój własny dokładnie wtedy, gdy oba są puste.
      title: "",
      description: "",
      unit:
        source === "traffic"
          ? t("adminDashboard.geo.unitSessions")
          : t("adminDashboard.geo.unitLeads"),
      values: rows.map((r) => ({ id: r.code, value: r.value })),
      showLegend: true,
      // Pulpit nie animuje: odświeża się sam, a mapa wjeżdżająca przy każdym
      // odświeżeniu czytałaby się jako zmiana danych.
      animate: false,
      source: "",
    }),
    [region, source, rows, t],
  );

  const toggle = (active: boolean) =>
    cn(
      "px-2 h-6 text-[11px] font-medium rounded-sm transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted",
    );

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div
          role="group"
          aria-label={t("adminDashboard.geo.title")}
          className="inline-flex gap-0.5 rounded-md border border-border p-0.5"
        >
          {(["traffic", "leads"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              aria-pressed={source === s}
              className={toggle(source === s)}
            >
              {t(`adminDashboard.geo.source.${s}`)}
            </button>
          ))}
        </div>
        <div className="inline-flex gap-0.5 rounded-md border border-border p-0.5">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              aria-pressed={region === r}
              className={toggle(region === r)}
            >
              {t(`adminDashboard.geo.region.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xs font-medium">{t("adminDashboard.geo.noGeo")}</p>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-md mx-auto">
            {t("adminDashboard.geo.noGeoHint")}
          </p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 items-start">
          <ChoroplethMap config={config} lang={lang} className="my-0" />
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">
              {t("adminDashboard.geo.countriesCounted")}: {formatCount(rows.length, lang)}
            </p>
            <RankedList
              rows={rows.map((r) => ({ id: r.code, label: nameOf(r.code), value: r.value }))}
              labelHeader={t("adminDashboard.geo.colCountry")}
              valueHeader={
                source === "traffic"
                  ? t("adminDashboard.traffic.colSessions")
                  : t("adminDashboard.crm.colLeads")
              }
              total={total}
              maxRows={10}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
