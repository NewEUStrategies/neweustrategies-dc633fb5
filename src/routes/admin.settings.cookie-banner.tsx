// Cookie banner admin page: colors, PL/EN copy, mechanism toggles.
// Persists into site_settings[key="cookie_banner_config"]; the live banner
// picks up changes automatically via useSiteSetting()/react-query invalidation.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Checkbox, SaveBar } from "@/components/admin/settings/fields";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import {
  COOKIE_BANNER_DEFAULTS,
  COOKIE_BANNER_SETTINGS_KEY,
  type CookieBannerConfig,
  type CookieBannerCopy,
  type CookieBannerColors,
} from "@/lib/cookieBanner/config";
import { ConsentBanner } from "@/components/ConsentBanner";
import { OPEN_PREFS_EVENT } from "@/lib/ads/consent";

export const Route = createFileRoute("/admin/settings/cookie-banner")({
  head: () => ({
    meta: [
      { title: "Cookie banner - Ustawienia" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CookieBannerSettings,
});

type Lang = "pl" | "en";

function ColorField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <AdminColorPicker
        value={value || undefined}
        onChange={(v) => onChange(v ?? "")}
        placeholder={placeholder}
        allowTransparent={false}
        ariaLabel={`${label} - wybierz kolor`}
      />
    </Field>
  );
}

function CopyEditor({
  lang,
  copy,
  onChange,
}: {
  lang: Lang;
  copy: CookieBannerCopy;
  onChange: (c: CookieBannerCopy) => void;
}) {
  const set = <K extends keyof CookieBannerCopy>(k: K, v: CookieBannerCopy[K]) =>
    onChange({ ...copy, [k]: v });
  const l = lang.toUpperCase();
  return (
    <div className="space-y-0 border border-border rounded-lg p-4">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">
        {l}
      </p>
      <Field label="Tytuł">
        <Text value={copy.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field label="Wstęp (długi)">
        <textarea
          value={copy.intro}
          onChange={(e) => set("intro", e.target.value)}
          rows={3}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label="Komunikat (kompakt)">
        <Text value={copy.compactMessage} onChange={(e) => set("compactMessage", e.target.value)} />
      </Field>
      <Field label="Etykieta polityki">
        <Text value={copy.policyLabel} onChange={(e) => set("policyLabel", e.target.value)} />
      </Field>
      <Field label="Przyciski">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Text
            value={copy.acceptAll}
            onChange={(e) => set("acceptAll", e.target.value)}
            placeholder="Akceptuj wszystkie"
          />
          <Text
            value={copy.rejectAll}
            onChange={(e) => set("rejectAll", e.target.value)}
            placeholder="Tylko niezbędne"
          />
          <Text
            value={copy.saveSelection}
            onChange={(e) => set("saveSelection", e.target.value)}
            placeholder="Zapisz wybrane"
          />
          <Text
            value={copy.showDetails}
            onChange={(e) => set("showDetails", e.target.value)}
            placeholder="Szczegóły"
          />
          <Text
            value={copy.hideDetails}
            onChange={(e) => set("hideDetails", e.target.value)}
            placeholder="Ukryj szczegóły"
          />
          <Text
            value={copy.showVendors}
            onChange={(e) => set("showVendors", e.target.value)}
            placeholder="Pokaż podmioty"
          />
          <Text
            value={copy.hideVendors}
            onChange={(e) => set("hideVendors", e.target.value)}
            placeholder="Ukryj podmioty"
          />
        </div>
      </Field>
      <Field label="Kategorie - nazwy">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Text
            value={copy.categoryNecessary}
            onChange={(e) => set("categoryNecessary", e.target.value)}
          />
          <Text
            value={copy.categoryFunctional}
            onChange={(e) => set("categoryFunctional", e.target.value)}
          />
          <Text
            value={copy.categoryAnalytics}
            onChange={(e) => set("categoryAnalytics", e.target.value)}
          />
          <Text
            value={copy.categoryMarketing}
            onChange={(e) => set("categoryMarketing", e.target.value)}
          />
        </div>
      </Field>
      <Field label="Opis - niezbędne">
        <textarea
          value={copy.descNecessary}
          onChange={(e) => set("descNecessary", e.target.value)}
          rows={2}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label="Opis - funkcjonalne">
        <textarea
          value={copy.descFunctional}
          onChange={(e) => set("descFunctional", e.target.value)}
          rows={2}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label="Opis - analityczne">
        <textarea
          value={copy.descAnalytics}
          onChange={(e) => set("descAnalytics", e.target.value)}
          rows={2}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label="Opis - marketing">
        <textarea
          value={copy.descMarketing}
          onChange={(e) => set("descMarketing", e.target.value)}
          rows={2}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
    </div>
  );
}

function CookieBannerSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<CookieBannerConfig>(
    COOKIE_BANNER_SETTINGS_KEY,
    COOKIE_BANNER_DEFAULTS,
  );
  const [draft, setDraft] = useDraft(query.data);
  const [copyLang, setCopyLang] = useState<Lang>("pl");
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!draft) {
    return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  }

  const setColor = <K extends keyof CookieBannerColors>(k: K, v: CookieBannerColors[K]) =>
    setDraft({ ...draft, colors: { ...draft.colors, [k]: v } });

  const setCopy = (lang: Lang, next: CookieBannerCopy) =>
    setDraft({ ...draft, copy: { ...draft.copy, [lang]: next } });

  const resetDefaults = () => {
    if (confirm("Przywrócić wartości domyślne (kolory + treści)?")) {
      setDraft(COOKIE_BANNER_DEFAULTS);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-display text-xl">Cookie banner</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Kolory, treści (PL/EN) oraz mechanizmy zgody. Zmiany są widoczne na żywo po zapisie.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors"
        >
          Podgląd
        </button>
      </div>

      {/* Mechanisms */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">Mechanizmy</h3>
        <Field label="Baner aktywny" hint="Wyłączenie ukrywa banner dla nowych użytkowników.">
          <Checkbox
            label="Pokazuj cookie banner"
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </Field>
        <Field label="Przełącznik języka" hint="Widoczny pill PL / EN wewnątrz banera.">
          <Checkbox
            label="Pokaż PL / EN w banerze"
            checked={draft.languageSwitcher}
            onChange={(v) => setDraft({ ...draft, languageSwitcher: v })}
          />
        </Field>
      </section>

      {/* Colors */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">Kolory (puste = motyw)</h3>
        <ColorField
          label="Powierzchnia"
          value={draft.colors.surface}
          onChange={(v) => setColor("surface", v)}
          placeholder="#0b0b0b"
        />
        <ColorField
          label="Tekst"
          value={draft.colors.foreground}
          onChange={(v) => setColor("foreground", v)}
          placeholder="#f5f5f5"
        />
        <ColorField
          label="Tło wtórne"
          value={draft.colors.muted}
          onChange={(v) => setColor("muted", v)}
          placeholder="#1f1f1f"
        />
        <ColorField
          label="Obramowanie"
          value={draft.colors.border}
          onChange={(v) => setColor("border", v)}
          placeholder="#2a2a2a"
        />
        <ColorField
          label="Akcent (primary)"
          value={draft.colors.accent}
          onChange={(v) => setColor("accent", v)}
          placeholder="#ff8a00"
        />
        <ColorField
          label="Akcent - tekst"
          value={draft.colors.accentForeground}
          onChange={(v) => setColor("accentForeground", v)}
          placeholder="#000000"
        />
      </section>

      {/* Copy */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Treści</h3>
          <div
            role="tablist"
            className="inline-flex rounded-md border border-border overflow-hidden"
          >
            {(["pl", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={copyLang === l}
                onClick={() => setCopyLang(l)}
                className={`px-3 py-1 text-xs font-semibold ${
                  copyLang === l ? "bg-brand text-brand-foreground" : "hover:bg-muted"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <CopyEditor
          lang={copyLang}
          copy={draft.copy[copyLang]}
          onChange={(c) => setCopy(copyLang, c)}
        />
      </section>

      <div className="flex items-center gap-3">
        <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
        <button
          type="button"
          onClick={resetDefaults}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Przywróć domyślne
        </button>
      </div>

      {previewOpen && <PreviewOverlay onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

// Live preview reuses ConsentBanner in "expanded" mode by dispatching the same
// event the footer uses. We wrap it with the current draft not-yet-saved by
// simply relying on the last saved config; the note below explains that.
function PreviewOverlay({ onClose }: { onClose: () => void }) {
  // ConsentBanner hides once the user has decided; dispatch OPEN_PREFS_EVENT so
  // it opens the expanded modal for the preview regardless of prior consent.
  useEffectOnce(() => {
    window.dispatchEvent(new Event(OPEN_PREFS_EVENT));
  });
  return (
    <div className="fixed inset-0 z-[70]">
      <ConsentBanner />
      <button
        type="button"
        onClick={onClose}
        className="fixed top-4 right-4 z-[90] h-9 px-3 rounded-md border border-border bg-card text-sm shadow-sm"
      >
        Zamknij podgląd
      </button>
    </div>
  );
}

function useEffectOnce(fn: () => void) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fn();
  }, [fn]);
}
