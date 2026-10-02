// Panel „Wykryte elementy": realny skan przeglądarki (cookies + storage)
// zestawiony z rejestrem deklaracji. Wpisy oznaczone `auto` to elementy, których
// nie ma w rejestrze - system opisuje je sam, żeby deklaracja nigdy nie była
// niepełna.
//
// Etykiety, nazwy kategorii i opis celu idą za językiem INTERFEJSU: rejestr
// niesie cel w obu wersjach (`purpose_pl` / `purpose_en`), a wcześniej panel
// czytał zawsze `purpose_pl` - przy interfejsie angielskim deklaracja
// „po angielsku" była po polsku.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { detectCollectedElements, type InventoryResult } from "@/lib/cookieBanner/registry";
import type { ConsentCategory } from "@/lib/ads/consent";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-cookie-banner";

ensureI18n();

const ORDER: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

export function DetectedElementsPanel() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [result, setResult] = useState<InventoryResult | null>(null);
  const scan = useCallback(() => setResult(detectCollectedElements()), []);

  useEffect(() => {
    scan();
  }, [scan]);

  if (!result) return null;

  return (
    <section className="mb-6">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-sm font-semibold">{t("adminCookieBanner.detected.title")}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t("adminCookieBanner.detected.scanSummary", { count: result.scannedKeys })}
          </p>
        </div>
        <button
          type="button"
          onClick={scan}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs hover:bg-muted transition-colors"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {t("adminCookieBanner.detected.rescan")}
        </button>
      </div>

      <div className="space-y-3">
        {ORDER.map((cat) => {
          const items = result.byCategory[cat];
          if (items.length === 0) return null;
          return (
            <div key={cat} className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 text-xs font-semibold">
                {t(`adminCookieBanner.detected.categories.${cat}`)}{" "}
                <span className="opacity-60">({items.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">
                        {t("adminCookieBanner.detected.columns.element")}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t("adminCookieBanner.detected.columns.storage")}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t("adminCookieBanner.detected.columns.purpose")}
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        {t("adminCookieBanner.detected.columns.keys")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item) => (
                      <tr key={`${item.kind}:${item.name}`} className="align-top">
                        <td className="px-3 py-2 font-mono">
                          {item.name}
                          {item.auto && (
                            <span className="ml-1 rounded bg-brand/15 px-1 py-0.5 font-sans text-[9px] uppercase text-brand">
                              {t("adminCookieBanner.detected.autoBadge")}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{item.kind}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {pickLocalized(item, "purpose", lang)}
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {item.detected?.length ? item.detected.join(", ") : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
