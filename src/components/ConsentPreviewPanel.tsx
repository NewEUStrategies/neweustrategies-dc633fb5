// Session-scoped consent preview panel. Enabled with ?consent-preview=1.
// Lets you toggle every category and see analytics/marketing scripts load
// or unload in real time - without touching the persisted decision.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clearConsentPreview,
  isConsentPreviewRequested,
  setConsentPreview,
  useEffectiveConsent,
  type ConsentCategory,
} from "@/lib/ads/consent";

const CATS: ConsentCategory[] = ["necessary", "functional", "analytics", "marketing"];

export function ConsentPreviewPanel() {
  const [visible, setVisible] = useState(false);
  const { categories, preview } = useEffectiveConsent();
  const { t } = useTranslation();

  useEffect(() => {
    setVisible(isConsentPreviewRequested());
  }, []);

  if (!visible) return null;

  const toggle = (cat: ConsentCategory, next: boolean) => {
    if (cat === "necessary") return;
    setConsentPreview({ ...categories, [cat]: next });
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg border border-border bg-card p-4 shadow-2xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-foreground">
          {t("consent.preview.title", { defaultValue: "Podgląd zgody" })}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${preview ? "bg-amber-500/20 text-amber-700" : "bg-muted text-muted-foreground"}`}
        >
          {preview
            ? t("consent.preview.active", { defaultValue: "AKTYWNY" })
            : t("consent.preview.inactive", { defaultValue: "REALNE" })}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {t("consent.preview.hint", {
          defaultValue: "Testuj skrypty bez czyszczenia cookies - override tylko dla tej sesji.",
        })}
      </p>
      <div className="space-y-2">
        {CATS.map((cat) => (
          <label key={cat} className="flex items-center justify-between text-sm">
            <span className="capitalize text-foreground">{cat}</span>
            <input
              type="checkbox"
              disabled={cat === "necessary"}
              checked={!!categories[cat]}
              onChange={(e) => toggle(cat, e.target.checked)}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() =>
            setConsentPreview({ functional: true, analytics: true, marketing: true })
          }
          className="flex-1 rounded-md bg-foreground px-2 py-1 text-xs text-background"
        >
          {t("consent.preview.acceptAll", { defaultValue: "Wszystko" })}
        </button>
        <button
          type="button"
          onClick={() => setConsentPreview({})}
          className="flex-1 rounded-md border border-border px-2 py-1 text-xs"
        >
          {t("consent.preview.rejectAll", { defaultValue: "Nic" })}
        </button>
        <button
          type="button"
          onClick={clearConsentPreview}
          className="rounded-md border border-border px-2 py-1 text-xs"
          title={t("consent.preview.reset", { defaultValue: "Wróć do rzeczywistej zgody" })}
        >
          ↺
        </button>
      </div>
    </div>
  );
}
