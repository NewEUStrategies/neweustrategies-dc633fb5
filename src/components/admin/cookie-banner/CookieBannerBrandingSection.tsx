// Cookie banner - logo (tryb jasny/ciemny) i dodatkowe odnośniki prawne.
//
// Etykiety idą za językiem INTERFEJSU panelu (`adminCookieBanner.branding.*`).
// Przy każdym odnośniku panel pokazuje, DOKĄD naprawdę poprowadzi on w każdej
// wersji banera (`bannerLinkHref`) - ścieżka wewnętrzna dostaje prefiks języka
// odwiedzającego, a adres niedozwolony nie trafi do banera wcale. Bez tego
// podglądu administrator wpisywał „/cookies" i nie miał jak się dowiedzieć,
// że wersja angielska prowadzi gdzie indziej niż polska.
import { useTranslation } from "react-i18next";
import { AppLink } from "@/components/atoms/AppLink";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { Field, Text, NumberInput } from "@/components/admin/settings/fields";
import {
  bannerLinkHref,
  clampCookieBannerLogoSize,
  type CookieBannerLink,
  type CookieBannerLogo,
} from "@/lib/cookieBanner/config";
import { ensureI18n } from "@/lib/i18n-admin-cookie-banner";

ensureI18n();

interface Props {
  logo: CookieBannerLogo;
  links: CookieBannerLink[];
  onLogoChange: (logo: CookieBannerLogo) => void;
  onLinksChange: (links: CookieBannerLink[]) => void;
}

/** Przykład adresu w polu - ścieżka, nie tekst do tłumaczenia. */
const URL_EXAMPLE = "/cookies";
/** Ekran, na którym ustawia się stronę polityki prywatności linkowaną przez baner. */
const PRIVACY_SETTINGS_HREF = "/admin/settings/privacy";

const newLink = (): CookieBannerLink => ({
  id: `lnk_${Math.random().toString(36).slice(2, 9)}`,
  url: "",
  label_pl: "",
  label_en: "",
});

export function CookieBannerBrandingSection({ logo, links, onLogoChange, onLinksChange }: Props) {
  const { t } = useTranslation();
  const setLink = (id: string, patch: Partial<CookieBannerLink>) =>
    onLinksChange(links.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <>
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">{t("adminCookieBanner.branding.logoTitle")}</h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t("adminCookieBanner.branding.logoHint")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CoverImagePicker
            label={t("adminCookieBanner.branding.logoLight")}
            value={logo.light}
            onChange={(v) => onLogoChange({ ...logo, light: v })}
          />
          <CoverImagePicker
            label={t("adminCookieBanner.branding.logoDark")}
            value={logo.dark}
            onChange={(v) => onLogoChange({ ...logo, dark: v })}
          />
        </div>
        <Field
          label={t("adminCookieBanner.branding.sizeLabel")}
          hint={t("adminCookieBanner.branding.sizeHint")}
        >
          <NumberInput
            value={logo.size}
            min={24}
            max={72}
            onChange={(e) => onLogoChange({ ...logo, size: Number(e.currentTarget.value) || 36 })}
            // Klamra przy opuszczeniu pola, nie przy każdym znaku: wpisywanie
            // „48" przechodzi przez „4", który klamra zamieniłaby na 24.
            onBlur={(e) =>
              onLogoChange({ ...logo, size: clampCookieBannerLogoSize(e.currentTarget.value) })
            }
          />
        </Field>
      </section>

      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">{t("adminCookieBanner.branding.linksTitle")}</h3>
          <button
            type="button"
            onClick={() => onLinksChange([...links, newLink()])}
            className="h-8 px-3 rounded-md border border-border text-xs hover:bg-muted transition-colors"
          >
            {t("adminCookieBanner.branding.addLink")}
          </button>
        </div>
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("adminCookieBanner.branding.linksEmpty")}{" "}
            <AppLink
              href={PRIVACY_SETTINGS_HREF}
              className="font-medium text-foreground underline underline-offset-2"
            >
              {t("adminCookieBanner.branding.privacySettingsLink")}
            </AppLink>
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              {t("adminCookieBanner.branding.urlHint")}
            </p>
            <ul className="space-y-3">
              {links.map((l) => {
                const hrefPl = bannerLinkHref(l.url, "pl");
                const hrefEn = bannerLinkHref(l.url, "en");
                const invalid = l.url.trim() !== "" && (hrefPl === null || hrefEn === null);
                const resolvedId = `${l.id}-resolved`;
                return (
                  <li key={l.id} className="border border-border rounded-lg p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Text
                        value={l.label_pl}
                        lang="pl"
                        placeholder={t("adminCookieBanner.branding.labelPl")}
                        aria-label={t("adminCookieBanner.branding.labelPl")}
                        onChange={(e) => setLink(l.id, { label_pl: e.target.value })}
                      />
                      <Text
                        value={l.label_en}
                        lang="en"
                        placeholder={t("adminCookieBanner.branding.labelEn")}
                        aria-label={t("adminCookieBanner.branding.labelEn")}
                        onChange={(e) => setLink(l.id, { label_en: e.target.value })}
                      />
                      <Text
                        value={l.url}
                        placeholder={URL_EXAMPLE}
                        aria-label={t("adminCookieBanner.branding.urlLabel")}
                        aria-describedby={resolvedId}
                        aria-invalid={invalid || undefined}
                        onChange={(e) => setLink(l.id, { url: e.target.value })}
                      />
                    </div>
                    <p
                      id={resolvedId}
                      className={`mt-2 text-[11px] ${invalid ? "text-destructive" : "font-mono text-muted-foreground"}`}
                    >
                      {invalid
                        ? t("adminCookieBanner.branding.invalidUrl")
                        : hrefPl && hrefEn
                          ? t("adminCookieBanner.branding.resolved", { pl: hrefPl, en: hrefEn })
                          : null}
                    </p>
                    <button
                      type="button"
                      onClick={() => onLinksChange(links.filter((x) => x.id !== l.id))}
                      className="mt-2 text-xs text-destructive underline underline-offset-2"
                    >
                      {t("adminCookieBanner.branding.remove")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
