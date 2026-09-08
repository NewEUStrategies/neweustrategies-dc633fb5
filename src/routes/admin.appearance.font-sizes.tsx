// Admin → Wygląd → Rozmiary czcionek.
// Jedna tabela tokenów typografii UI. CSS w `src/styles.css` konsumuje
// wyłącznie zmienne `--fs-*`, więc zapis tutaj jest JEDYNYM miejscem zmiany
// rozmiarów etykiet, pól, list rozwijanych, przycisków i pola czatu.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Save } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFontScale, useSaveFontScale } from "@/hooks/useFontScale";
import {
  EMPTY_FONT_SCALE,
  FONT_SCALE_TOKENS,
  effectiveFontSize,
  type FontScaleValue,
} from "@/lib/theme/fontScale";
import { ensureI18n as ensureFontSizesI18n } from "@/lib/i18n-admin-font-sizes";

export const Route = createFileRoute("/admin/appearance/font-sizes")({
  component: FontSizesPage,
});

function FontSizesPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureFontSizesI18n();
  const { t } = useTranslation();
  const { data, isLoading } = useFontScale();
  const save = useSaveFontScale();
  const [draft, setDraft] = useState<FontScaleValue | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  if (isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">{t("fontScale.loading")}</p>;
  }

  const setSize = (key: string, raw: string) => {
    setDraft((prev) => {
      const base = prev ?? EMPTY_FONT_SCALE;
      if (raw.trim() === "") {
        const { [key]: _drop, ...rest } = base;
        return rest;
      }
      const px = Number(raw.replace(",", "."));
      if (!Number.isFinite(px)) return base;
      return { ...base, [key]: px };
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-display text-2xl">{t("fontScale.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("fontScale.intro")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(EMPTY_FONT_SCALE)}
            disabled={save.isPending}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("fontScale.reset")}
          </Button>
          <Button type="button" onClick={() => save.mutate(draft)} disabled={save.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? t("fontScale.saving") : t("fontScale.save")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[6px] border border-border">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.element")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.scope")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.variable")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.defaultSize")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.size")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.preview")}</th>
            </tr>
          </thead>
          <tbody>
            {FONT_SCALE_TOKENS.map((token) => {
              const current = effectiveFontSize(draft, token.key);
              const overridden = typeof draft[token.key] === "number";
              return (
                <tr key={token.key} className="border-t border-border align-middle">
                  <td className="px-3 py-2 font-medium">{t(token.labelKey)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t(token.scopeKey)}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{token.cssVar}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {overridden ? `${token.defaultPx} px` : t("fontScale.resetRow")}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min={token.minPx}
                      max={token.maxPx}
                      className="w-24"
                      aria-label={t(token.labelKey)}
                      value={String(current)}
                      onChange={(e) => setSize(token.key, e.target.value)}
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {t("fontScale.range", { min: token.minPx, max: token.maxPx })}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span style={{ fontSize: `${current}px` }}>{t("fontScale.previewText")}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
