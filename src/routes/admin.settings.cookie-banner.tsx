// Cookie banner admin page: colors, PL/EN copy, mechanism toggles.
// Persists into site_settings[key="cookie_banner_config"]; the live banner
// picks up changes automatically via useSiteSetting()/react-query invalidation.
//
// DWA JĘZYKI NA JEDNYM EKRANIE. Etykiety panelu idą za językiem INTERFEJSU
// (`adminCookieBanner.*`, `@/lib/i18n-admin-cookie-banner`), a podpowiedzi
// w polach treści - za zakładką edytowanej WERSJI banera (domyślne brzmienia
// `COOKIE_BANNER_DEFAULTS.copy[lang]`). Administrator z interfejsem po polsku
// edytujący wersję angielską widzi więc polskie etykiety i angielskie
// przykłady - bo to jest angielski baner.
import i18n from "@/lib/i18n";
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
import { CookieBannerBrandingSection } from "@/components/admin/cookie-banner/CookieBannerBrandingSection";
import { DetectedElementsPanel } from "@/components/admin/cookie-banner/DetectedElementsPanel";
import { requestConsentPreferences } from "@/lib/ads/consent";
import { ensureI18n } from "@/lib/i18n-admin-cookie-banner";

ensureI18n();

export const Route = createFileRoute("/admin/settings/cookie-banner")({
  head: () => ({
    meta: [
      { title: i18n.t("adminCookieBanner.headTitle") },
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
  const { t } = useTranslation();
  return (
    <Field label={label}>
      <AdminColorPicker
        value={value || undefined}
        onChange={(v) => onChange(v ?? "")}
        placeholder={placeholder}
        allowTransparent={false}
        ariaLabel={t("adminCookieBanner.colors.pickAria", { label })}
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
  const { t } = useTranslation();
  const set = <K extends keyof CookieBannerCopy>(k: K, v: CookieBannerCopy[K]) =>
    onChange({ ...copy, [k]: v });
  // Przykłady w polach są brzmieniami domyślnymi EDYTOWANEJ wersji banera,
  // nie językiem interfejsu - patrz nagłówek pliku.
  const example = COOKIE_BANNER_DEFAULTS.copy[lang];
  const field = (key: keyof CookieBannerCopy) => t(`adminCookieBanner.copy.fields.${key}`);
  return (
    <div className="space-y-0 border border-border rounded-lg p-4">
      <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">
        {t(`adminCookieBanner.copy.versionName.${lang}`)}
      </p>
      <Field label={field("title")}>
        <Text
          value={copy.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={example.title}
        />
      </Field>
      <Field label={field("intro")}>
        <textarea
          value={copy.intro}
          onChange={(e) => set("intro", e.target.value)}
          placeholder={example.intro}
          rows={3}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label={field("compactMessage")}>
        <Text
          value={copy.compactMessage}
          onChange={(e) => set("compactMessage", e.target.value)}
          placeholder={example.compactMessage}
        />
      </Field>
      <Field label={field("policyLabel")}>
        <Text
          value={copy.policyLabel}
          onChange={(e) => set("policyLabel", e.target.value)}
          placeholder={example.policyLabel}
        />
      </Field>
      <Field label={t("adminCookieBanner.copy.fields.buttons")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Text
            value={copy.acceptAll}
            onChange={(e) => set("acceptAll", e.target.value)}
            placeholder={example.acceptAll}
          />
          <Text
            value={copy.rejectAll}
            onChange={(e) => set("rejectAll", e.target.value)}
            placeholder={example.rejectAll}
          />
          <Text
            value={copy.saveSelection}
            onChange={(e) => set("saveSelection", e.target.value)}
            placeholder={example.saveSelection}
          />
          <Text
            value={copy.customize}
            onChange={(e) => set("customize", e.target.value)}
            placeholder={example.customize}
          />
          <Text
            value={copy.showDetails}
            onChange={(e) => set("showDetails", e.target.value)}
            placeholder={example.showDetails}
          />
          <Text
            value={copy.hideDetails}
            onChange={(e) => set("hideDetails", e.target.value)}
            placeholder={example.hideDetails}
          />
          <Text
            value={copy.showVendors}
            onChange={(e) => set("showVendors", e.target.value)}
            placeholder={example.showVendors}
          />
          <Text
            value={copy.hideVendors}
            onChange={(e) => set("hideVendors", e.target.value)}
            placeholder={example.hideVendors}
          />
        </div>
      </Field>
      <Field label={t("adminCookieBanner.copy.fields.categories")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Text
            value={copy.categoryNecessary}
            onChange={(e) => set("categoryNecessary", e.target.value)}
            placeholder={example.categoryNecessary}
          />
          <Text
            value={copy.categoryFunctional}
            onChange={(e) => set("categoryFunctional", e.target.value)}
            placeholder={example.categoryFunctional}
          />
          <Text
            value={copy.categoryAnalytics}
            onChange={(e) => set("categoryAnalytics", e.target.value)}
            placeholder={example.categoryAnalytics}
          />
          <Text
            value={copy.categoryMarketing}
            onChange={(e) => set("categoryMarketing", e.target.value)}
            placeholder={example.categoryMarketing}
          />
        </div>
      </Field>
      <Field label={field("descNecessary")}>
        <textarea
          value={copy.descNecessary}
          onChange={(e) => set("descNecessary", e.target.value)}
          placeholder={example.descNecessary}
          rows={2}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label={field("descFunctional")}>
        <textarea
          value={copy.descFunctional}
          onChange={(e) => set("descFunctional", e.target.value)}
          placeholder={example.descFunctional}
          rows={2}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label={field("descAnalytics")}>
        <textarea
          value={copy.descAnalytics}
          onChange={(e) => set("descAnalytics", e.target.value)}
          placeholder={example.descAnalytics}
          rows={2}
          className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label={field("descMarketing")}>
        <textarea
          value={copy.descMarketing}
          onChange={(e) => set("descMarketing", e.target.value)}
          placeholder={example.descMarketing}
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
    if (confirm(t("adminCookieBanner.restoreConfirm"))) {
      setDraft(COOKIE_BANNER_DEFAULTS);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-display text-xl">{t("adminCookieBanner.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("adminCookieBanner.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors"
        >
          {t("adminCookieBanner.preview")}
        </button>
      </div>

      <CookieBannerBrandingSection
        logo={draft.logo}
        links={draft.links}
        onLogoChange={(logo) => setDraft({ ...draft, logo })}
        onLinksChange={(links) => setDraft({ ...draft, links })}
      />

      <DetectedElementsPanel />

      {/* Mechanisms */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">{t("adminCookieBanner.mechanisms.title")}</h3>
        <Field
          label={t("adminCookieBanner.mechanisms.enabledLabel")}
          hint={t("adminCookieBanner.mechanisms.enabledHint")}
        >
          <Checkbox
            label={t("adminCookieBanner.mechanisms.enabledCheckbox")}
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </Field>
        <Field
          label={t("adminCookieBanner.mechanisms.languageSwitcherLabel")}
          hint={t("adminCookieBanner.mechanisms.languageSwitcherHint")}
        >
          <Checkbox
            label={t("adminCookieBanner.mechanisms.languageSwitcherCheckbox")}
            checked={draft.languageSwitcher}
            onChange={(v) => setDraft({ ...draft, languageSwitcher: v })}
          />
        </Field>
        <Field
          label={t("adminCookieBanner.mechanisms.autoInventoryLabel")}
          hint={t("adminCookieBanner.mechanisms.autoInventoryHint")}
        >
          <Checkbox
            label={t("adminCookieBanner.mechanisms.autoInventoryCheckbox")}
            checked={draft.autoInventory}
            onChange={(v) => setDraft({ ...draft, autoInventory: v })}
          />
        </Field>
      </section>

      {/* Colors */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">{t("adminCookieBanner.colors.title")}</h3>
        <ColorField
          label={t("adminCookieBanner.colors.surface")}
          value={draft.colors.surface}
          onChange={(v) => setColor("surface", v)}
          placeholder="#0b0b0b"
        />
        <ColorField
          label={t("adminCookieBanner.colors.foreground")}
          value={draft.colors.foreground}
          onChange={(v) => setColor("foreground", v)}
          placeholder="#f5f5f5"
        />
        <ColorField
          label={t("adminCookieBanner.colors.muted")}
          value={draft.colors.muted}
          onChange={(v) => setColor("muted", v)}
          placeholder="#1f1f1f"
        />
        <ColorField
          label={t("adminCookieBanner.colors.border")}
          value={draft.colors.border}
          onChange={(v) => setColor("border", v)}
          placeholder="#2a2a2a"
        />
        <ColorField
          label={t("adminCookieBanner.colors.accent")}
          value={draft.colors.accent}
          onChange={(v) => setColor("accent", v)}
          placeholder="#ff8a00"
        />
        <ColorField
          label={t("adminCookieBanner.colors.accentForeground")}
          value={draft.colors.accentForeground}
          onChange={(v) => setColor("accentForeground", v)}
          placeholder="#000000"
        />
      </section>

      {/* Copy */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t("adminCookieBanner.copy.title")}</h3>
          <div
            role="tablist"
            aria-label={t("adminCookieBanner.copy.versionsLabel")}
            className="inline-flex rounded-md border border-border overflow-hidden"
          >
            {(["pl", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={copyLang === l}
                title={t(`adminCookieBanner.copy.versionName.${l}`)}
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
          {t("adminCookieBanner.restoreDefaults")}
        </button>
      </div>

      {previewOpen && <PreviewOverlay config={draft} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

// Podgląd na żywo: ConsentBanner dostaje NIEZAPISANY szkic (configOverride),
// więc kolory, logo, treści i odnośniki widać przed kliknięciem „Zapisz".
function PreviewOverlay({ config, onClose }: { config: CookieBannerConfig; onClose: () => void }) {
  const { t } = useTranslation();
  const [surface, setSurface] = useState<"light" | "dark">("light");
  // ConsentBanner hides once the user has decided; dispatch OPEN_PREFS so
  // it opens the expanded modal for the preview regardless of prior consent.
  useEffectOnce(() => {
    requestConsentPreferences();
  });
  return (
    <div className="fixed inset-0 z-[70]">
      <ConsentBanner configOverride={config} themeOverride={surface} />
      <div className="fixed top-4 right-4 z-[90] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSurface((s) => (s === "light" ? "dark" : "light"))}
          className="h-9 px-3 rounded-md border border-border bg-card text-sm shadow-sm"
        >
          {surface === "light"
            ? t("adminCookieBanner.previewLogoLight")
            : t("adminCookieBanner.previewLogoDark")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-3 rounded-md border border-border bg-card text-sm shadow-sm"
        >
          {t("adminCookieBanner.previewClose")}
        </button>
      </div>
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
