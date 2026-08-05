// Panel „Wykryte elementy": realny skan przeglądarki (cookies + storage)
// zestawiony z rejestrem deklaracji. Wpisy oznaczone `auto` to elementy, których
// nie ma w rejestrze - system opisuje je sam, żeby deklaracja nigdy nie była
// niepełna.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { detectCollectedElements, type InventoryResult } from "@/lib/cookieBanner/registry";
import type { ConsentCategory } from "@/lib/ads/consent";

const CATEGORY_LABELS: Record<ConsentCategory, string> = {
  necessary: "Niezbędne",
  functional: "Funkcjonalne",
  analytics: "Analityczne",
  marketing: "Marketingowe",
};

const ORDER: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

export function DetectedElementsPanel() {
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
          <h3 className="text-sm font-semibold">Wykryte elementy</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Skan przeglądarki: {result.scannedKeys} kluczy (cookies, localStorage,
            sessionStorage). Elementy spoza rejestru zostały opisane automatycznie i trafiają do
            deklaracji w banerze.
          </p>
        </div>
        <button
          type="button"
          onClick={scan}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs hover:bg-muted transition-colors"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Skanuj ponownie
        </button>
      </div>

      <div className="space-y-3">
        {ORDER.map((cat) => {
          const items = result.byCategory[cat];
          if (items.length === 0) return null;
          return (
            <div key={cat} className="border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 text-xs font-semibold">
                {CATEGORY_LABELS[cat]} <span className="opacity-60">({items.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Element</th>
                      <th className="px-3 py-2 text-left font-medium">Źródło</th>
                      <th className="px-3 py-2 text-left font-medium">Cel</th>
                      <th className="px-3 py-2 text-left font-medium">Wykryte klucze</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item) => (
                      <tr key={`${item.kind}:${item.name}`} className="align-top">
                        <td className="px-3 py-2 font-mono">
                          {item.name}
                          {item.auto && (
                            <span className="ml-1 rounded bg-brand/15 px-1 py-0.5 font-sans text-[9px] uppercase text-brand">
                              auto
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{item.kind}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.purpose_pl}</td>
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
