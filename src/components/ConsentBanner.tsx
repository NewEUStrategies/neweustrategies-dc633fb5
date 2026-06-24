// Usercentrics-style CMP. Pokazuje baner tylko gdy brak decyzji w danej wersji
// CONSENT_VERSION. Decyzja jest zapamiętywana w localStorage oraz - po zalogowaniu -
// synchronizowana do profiles.prefs.consent (per użytkownik / per tenant).
// Stopka może otworzyć preferencje przez `openConsentPreferences()` lub event `consent-open-preferences`.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useConsent, OPEN_PREFS_EVENT, type ConsentCategory } from "@/lib/ads/consent";

type Cats = Record<ConsentCategory, boolean>;

const CATEGORY_LABELS: Record<ConsentCategory, { pl: string; en: string; desc_pl: string; desc_en: string }> = {
  necessary: {
    pl: "Niezbędne", en: "Necessary",
    desc_pl: "Wymagane do działania strony (sesja, bezpieczeństwo). Nie można wyłączyć.",
    desc_en: "Required for the site to function (session, security). Cannot be disabled.",
  },
  functional: {
    pl: "Funkcjonalne", en: "Functional",
    desc_pl: "Zapamiętywanie preferencji (język, motyw, układ).",
    desc_en: "Remember preferences (language, theme, layout).",
  },
  analytics: {
    pl: "Analityczne", en: "Analytics",
    desc_pl: "Pomiar ruchu i wydajności w sposób zagregowany.",
    desc_en: "Aggregated traffic and performance measurement.",
  },
  marketing: {
    pl: "Marketingowe", en: "Marketing",
    desc_pl: "Personalizacja reklam i mierzenie ich skuteczności.",
    desc_en: "Ad personalization and measurement.",
  },
};

export function ConsentBanner() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { state, decided, mounted, save, acceptAll, rejectAll } = useConsent();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [draft, setDraft] = useState<Cats>(() => ({
    necessary: true,
    functional: state?.categories.functional ?? true,
    analytics: state?.categories.analytics ?? true,
    marketing: state?.categories.marketing ?? false,
  }));

  // Pozwól otworzyć preferencje z dowolnego miejsca (np. stopka).
  useEffect(() => {
    const open = () => {
      setDraft({
        necessary: true,
        functional: state?.categories.functional ?? true,
        analytics: state?.categories.analytics ?? true,
        marketing: state?.categories.marketing ?? false,
      });
      setPrefsOpen(true);
    };
    window.addEventListener(OPEN_PREFS_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFS_EVENT, open);
  }, [state]);

  // SSR-safe: nic nie renderuj do hydracji.
  if (!mounted) return null;
  if (decided && !prefsOpen) return null;

  const t = {
    title: isPl ? "Twoja prywatność" : "Your privacy",
    intro: isPl
      ? "Używamy plików cookie, aby zapewnić działanie strony, mierzyć ruch i personalizować reklamy. Wybierz, które kategorie akceptujesz - decyzję możesz zmienić w stopce."
      : "We use cookies to run the site, measure traffic and personalize ads. Choose which categories you accept - you can change this later from the footer.",
    accept: isPl ? "Akceptuj wszystkie" : "Accept all",
    reject: isPl ? "Tylko niezbędne" : "Reject all",
    customize: isPl ? "Dostosuj" : "Customize",
    save: isPl ? "Zapisz wybór" : "Save preferences",
    back: isPl ? "Wróć" : "Back",
    prefsTitle: isPl ? "Preferencje prywatności" : "Privacy preferences",
  };

  if (!prefsOpen) {
    return (
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t.title}
        className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-3xl rounded-lg border border-border bg-card text-card-foreground shadow-2xl p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">{t.title}</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{t.intro}</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setPrefsOpen(true)}>{t.customize}</Button>
            <Button variant="outline" size="sm" onClick={rejectAll}>{t.reject}</Button>
            <Button size="sm" onClick={acceptAll}>{t.accept}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.prefsTitle}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 bg-foreground/60 backdrop-blur-sm animate-in fade-in"
      onClick={() => { if (decided) setPrefsOpen(false); }}
    >
      <div
        className="w-full max-w-lg bg-card text-foreground rounded-xl border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border">
          <h2 className="text-lg font-semibold">{t.prefsTitle}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t.intro}</p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
          {(Object.keys(CATEGORY_LABELS) as ConsentCategory[]).map((cat) => {
            const meta = CATEGORY_LABELS[cat];
            const locked = cat === "necessary";
            return (
              <div key={cat} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{isPl ? meta.pl : meta.en}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {isPl ? meta.desc_pl : meta.desc_en}
                  </p>
                </div>
                <Switch
                  checked={locked ? true : draft[cat]}
                  disabled={locked}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, [cat]: !!v }))}
                  aria-label={isPl ? meta.pl : meta.en}
                />
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-t border-border bg-muted/30">
          <Button variant="ghost" size="sm" onClick={rejectAll}>{t.reject}</Button>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { if (decided) setPrefsOpen(false); }}
              disabled={!decided}
            >
              {t.back}
            </Button>
            <Button
              size="sm"
              onClick={() => { save(draft); setPrefsOpen(false); }}
            >
              {t.save}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { acceptAll(); setPrefsOpen(false); }}>
              {t.accept}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
