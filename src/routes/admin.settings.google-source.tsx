// Admin → Ustawienia → Preferowane źródło Google.
// Włącznik, adresy docelowe PL/EN, logo (jasne/ciemne) oraz zachowanie badge
// na desktopie i mobile. Zapis do site_settings[key="google_source_badge"];
// publiczny badge czyta te same wartości przez useSiteSetting().
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Checkbox, SaveBar } from "@/components/admin/settings/fields";
import { GoogleSourceBadgeDeviceSection } from "@/components/admin/google-source/GoogleSourceBadgeDeviceSection";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { NumberInput } from "@/components/admin/settings/fields";
import { GooglePreferredSourceBadge } from "@/components/seo/GooglePreferredSourceBadge";
import {
  GOOGLE_SOURCE_BADGE_DEFAULTS,
  GOOGLE_SOURCE_BADGE_SETTINGS_KEY,
  clampLogoSize,
  googlePreferredSourceUrl,
  type GoogleSourceBadgeConfig,
} from "@/lib/seo/googleSourceBadge";

export const Route = createFileRoute("/admin/settings/google-source")({
  head: () => ({
    meta: [
      { title: "Preferowane źródło Google - Ustawienia" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: GoogleSourceSettings,
});

function GoogleSourceSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<GoogleSourceBadgeConfig>(
    GOOGLE_SOURCE_BADGE_SETTINGS_KEY,
    GOOGLE_SOURCE_BADGE_DEFAULTS,
  );
  const [draft, setDraft] = useDraft(query.data);
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("light");

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  return (
    <div>
      <h2 className="font-display text-xl">Preferowane źródło Google</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Badge obok „Udostępnij pełny artykuł" prowadzący czytelnika do panelu preferowanych źródeł
        Google. Każde kliknięcie trafia do raportów jako zdarzenie
        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">
          google_preferred_source_click
        </code>
        (Analityka → zdarzenia CTA).
      </p>

      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">Widoczność i adresy</h3>
        <Field label="Badge aktywny" hint="Wyłączenie ukrywa badge w całym serwisie.">
          <Checkbox
            label="Pokazuj badge preferowanego źródła"
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </Field>
        <Field label="Adres docelowy (PL)" hint="Puste = domyślny panel Google dla naszej domeny.">
          <Text
            value={draft.url_pl}
            placeholder={googlePreferredSourceUrl()}
            onChange={(e) => setDraft({ ...draft, url_pl: e.target.value })}
          />
        </Field>
        <Field label="Adres docelowy (EN)" hint="Osobny adres dla wersji angielskiej serwisu.">
          <Text
            value={draft.url_en}
            placeholder={googlePreferredSourceUrl()}
            onChange={(e) => setDraft({ ...draft, url_en: e.target.value })}
          />
        </Field>
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">Logo badge</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Puste pole = wbudowany sygnet Google. Wariant ciemny jest używany w trybie ciemnym (brak =
          użyty jasny).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CoverImagePicker
            label="Logo - tryb jasny"
            value={draft.logo.light}
            onChange={(v) => setDraft({ ...draft, logo: { ...draft.logo, light: v } })}
          />
          <CoverImagePicker
            label="Logo - tryb ciemny"
            value={draft.logo.dark}
            onChange={(v) => setDraft({ ...draft, logo: { ...draft.logo, dark: v } })}
          />
        </div>
        <Field label="Rozmiar sygnetu (px)" hint="Zakres 10-32 px.">
          <NumberInput
            value={draft.logo.size}
            min={10}
            max={32}
            onChange={(e) =>
              setDraft({
                ...draft,
                logo: { ...draft.logo, size: clampLogoSize(e.currentTarget.value) },
              })
            }
          />
        </Field>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <GoogleSourceBadgeDeviceSection
          title="Desktop"
          placement={draft.desktop}
          onChange={(desktop) => setDraft({ ...draft, desktop })}
        />
        <GoogleSourceBadgeDeviceSection
          title="Mobile"
          placement={draft.mobile}
          onChange={(mobile) => setDraft({ ...draft, mobile })}
        />
      </div>

      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Podgląd (niezapisany szkic)</h3>
          <button
            type="button"
            onClick={() => setPreviewTheme((s) => (s === "light" ? "dark" : "light"))}
            className="h-8 px-3 rounded-md border border-border text-xs hover:bg-muted transition-colors"
          >
            {previewTheme === "light" ? "Logo: jasne" : "Logo: ciemne"}
          </button>
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          {(["desktop", "mobile"] as const).map((device) => (
            <div key={device}>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {device}
              </p>
              <GooglePreferredSourceBadge
                device={device}
                configOverride={draft}
                themeOverride={previewTheme}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
        <button
          type="button"
          onClick={() => setDraft(GOOGLE_SOURCE_BADGE_DEFAULTS)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Przywróć domyślne
        </button>
      </div>
    </div>
  );
}
