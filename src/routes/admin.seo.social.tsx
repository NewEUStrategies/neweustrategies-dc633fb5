// Karty społecznościowe (/admin/seo/social) - jeden obrazek i jedne teksty,
// pokazane w kadrze KAŻDEJ sieci osobno.
//
// CO BYŁO WCZEŚNIEJ. Całą kartą udostępniania sterowało jedno pole `og:image`
// schowane w /admin/settings/social-preview, a pod nim stała JEDNA makieta
// 1200x630 - ogólna, niczyja. Z takiego podglądu nie da się odczytać rzeczy,
// która w praktyce psuje najwięcej linków: „karta społecznościowa" nie jest
// jednym bytem. Facebook i LinkedIn czytają `og:*`, X czyta `twitter:*`
// i przycina tytuł o kilkadziesiąt znaków wcześniej, Slack i WhatsApp rysują
// wąski unfurl, a Google bierze z obrazka centralny kwadrat. Redakcja pisała
// więc tytuł, który mieścił się na LinkedInie, i dowiadywała się o ucięciu na
// X dopiero z gotowego posta - albo wcale.
//
// CO ROBI TEN EKRAN. Ustawia kartę domyślną (obrazek, jego opis alternatywny
// i typ karty na X), a niżej renderuje TE SAME wartości przez specyfikacje
// z `lib/seo/socialNetworks` - pięć podglądów obok siebie, każdy z własnym
// kadrem i własnym progiem przycięcia. Porównanie jest uczciwe, bo wszystkie
// karty dostają dokładnie jeden komplet danych; różni je wyłącznie sieć.
//
// WYMIARY PLIKU sprawdzamy w przeglądarce (`new Image()`), a nie na serwerze:
// obrazek bywa wgrany przed chwilą albo wskazany adresem spoza naszego
// storage'u, a jedyne, co redakcję interesuje, to czy TEN plik przejdzie przez
// sieci bez degradacji karty do małego wariantu.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureI18n } from "@/lib/i18n-admin-seo-hub";
import { ensureI18n as ensureOgUploadI18n } from "@/lib/i18n-og-upload";
import { useAuth } from "@/hooks/useAuth";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Select, SaveBar } from "@/components/admin/settings/fields";
import { ImageSlot, type ImageSlotTransform } from "@/components/admin/ImageSlot";
import { SocialCardPreview } from "@/components/admin/seo/SocialCardPreview";
import { LivePreviewLinks } from "@/components/admin/seo/LivePreviewLinks";
import { formatBytes } from "@/components/admin/media/lib/mediaFormat";
import { prepareOgImageFile, type OgIssue } from "@/lib/media/ogImage";
import { socialSourceRows } from "@/lib/seo/socialPreviewSources";
import { DEFAULT_SEO_SETTINGS, SEO_SETTINGS_KEY, type SeoSettings } from "@/lib/seo/settings";
import {
  SITE_CANONICAL_ORIGIN,
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_OG_IMAGE,
  SITE_DEFAULT_TITLE,
  SITE_NAME,
  type Lang,
} from "@/lib/seo/meta";
import {
  OG_RECOMMENDED_HEIGHT,
  OG_RECOMMENDED_WIDTH,
  SOCIAL_NETWORKS,
  displayHost,
  fallbackImageAlt,
  ogDimensionVerdict,
  socialNetworkSpec,
  type SocialNetworkSpec,
} from "@/lib/seo/socialNetworks";

export const Route = createFileRoute("/admin/seo/social")({
  component: SeoSocialTab,
  // Literał, nie `t()`: `head()` czytające słownik wciąga jego graf do chunku
  // wejściowego KAŻDEJ strony (scripts/check-entry-purity.ts).
  head: () => ({ meta: [{ title: "SEO - Karty społecznościowe" }] }),
});

interface NaturalSize {
  width: number;
  height: number;
}

function SeoSocialTab() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-seo-hub.ts.
  ensureI18n();
  // Druga nakładka jest potrzebna, bo walidator uploadu niżej woła klucze
  // `ogUpload.*` - ich właścicielem jest lib/i18n-og-upload.
  ensureOgUploadI18n();
  const { t, i18n } = useTranslation();
  // AUTORYTET. `site_settings` przyjmuje zapis wyłącznie od roli `admin`
  // (polityki RLS), a wspólny layout `/admin` wpuszcza cały personel - także
  // `editor` i `author`. Ekran z aktywnym „Zapisz" dla redaktora oferowałby
  // akcję, którą baza odrzuci: formularz wygląda na jego, a zapis wraca
  // błędem. Dlatego bez roli `admin` zostaje pełny podgląd, a zapis gaśnie.
  const { isAdmin } = useAuth();
  const { query, save } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const [draft, setDraft] = useDraft<SeoSettings>(query.data);
  const [previewLang, setPreviewLang] = useState<Lang>(
    i18n.language?.startsWith("en") ? "en" : "pl",
  );
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);

  // Adres obrazka liczymy PRZED wyjściem na ładowaniu, żeby efekt pomiaru
  // wymiarów stał wyżej niż jakikolwiek wczesny return (kolejność hooków).
  const effectiveImage = draft
    ? draft.default_og_image_url.trim() || `${SITE_CANONICAL_ORIGIN}${SITE_DEFAULT_OG_IMAGE}`
    : "";

  useEffect(() => {
    // Nowy adres = nieznane wymiary. Bez tego zerowania po podmianie pliku
    // przez chwilę widać werdykt POPRZEDNIEGO obrazka.
    setNaturalSize(null);
    if (typeof window === "undefined" || effectiveImage === "") return;
    let cancelled = false;
    // Pomiar na obiekcie poza drzewem: `<img>` w podglądzie jest przycięty
    // przez `object-cover`, więc jego rozmiar renderu nic nie mówi o pliku.
    const probe = new window.Image();
    probe.onload = () => {
      if (!cancelled) setNaturalSize({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    // Adres spoza storage'u, 404 albo blokada CORS - wtedy po prostu nie znamy
    // wymiarów i mówimy to wprost, zamiast udawać werdykt.
    probe.onerror = () => {
      if (!cancelled) setNaturalSize(null);
    };
    probe.src = effectiveImage;
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [effectiveImage]);

  const transformOgFile: ImageSlotTransform = async (file) => {
    const result = await prepareOgImageFile(file);
    const message = (issue: OgIssue) => t(`ogUpload.${issue.code}`, { ...(issue.params ?? {}) });
    const errors = result.issues.filter((i) => i.severity === "error").map(message);
    const warnings = result.issues.filter((i) => i.severity === "warning").map(message);
    if (result.file && result.bytesAfter < result.bytesBefore)
      warnings.push(
        t("ogUpload.optimized", {
          before: formatBytes(result.bytesBefore),
          after: formatBytes(result.bytesAfter),
        }),
      );
    return { file: result.file, errors, warnings };
  };

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof SeoSettings>(k: K, v: SeoSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  const verdict = ogDimensionVerdict(naturalSize?.width, naturalSize?.height);
  const verdictMessage =
    verdict === "ok"
      ? t("adminSeoHub.dimensionsOk")
      : verdict === "tooSmall"
        ? t("adminSeoHub.dimensionsTooSmall", {
            width: naturalSize?.width ?? 0,
            height: naturalSize?.height ?? 0,
          })
        : verdict === "wrongRatio"
          ? t("adminSeoHub.dimensionsWrongRatio", {
              width: OG_RECOMMENDED_WIDTH,
              height: OG_RECOMMENDED_HEIGHT,
            })
          : t("adminSeoHub.dimensionsUnknown");
  const verdictClass =
    verdict === "ok"
      ? "text-emerald-500"
      : verdict === "unknown"
        ? "text-muted-foreground"
        : "text-amber-500";

  // Wybór POLA po języku podglądu (nie tekstu) - mapa zamiast ternary, żeby
  // było widać, że to odczyt kolumny, a nie kopia treści w dwóch wersjach.
  const draftTitle = { pl: draft.site_title_pl, en: draft.site_title_en }[previewLang];
  const draftDescription = {
    pl: draft.site_description_pl,
    en: draft.site_description_en,
  }[previewLang];

  const siteName = draft.site_name.trim() || SITE_NAME;
  const previewTitle = draftTitle.trim() || SITE_DEFAULT_TITLE[previewLang];
  const previewDescription = draftDescription.trim() || SITE_DEFAULT_DESCRIPTION[previewLang];
  const previewHost = displayHost(SITE_CANONICAL_ORIGIN);
  const previewAlt = draft.default_og_image_alt.trim() || fallbackImageAlt(siteName, previewLang);

  // X czyta `twitter:card`: przy „summary" nie rysuje szerokiego banera, tylko
  // kwadratową miniaturę obok tekstu. Podgląd musi iść za tym ustawieniem,
  // inaczej pokazywałby wariant, którego redakcja właśnie wyłączyła.
  const specFor = (spec: SocialNetworkSpec): SocialNetworkSpec =>
    spec.id === "x" && draft.twitter_card_type === "summary"
      ? { ...socialNetworkSpec("x"), aspect: "1 / 1" }
      : spec;

  const rows = socialSourceRows(previewLang);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("adminSeoHub.socialIntro")}</p>

      {isAdmin ? null : (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {t("adminSeoHub.readOnlyNotice")}
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-base font-semibold">{t("adminSeoHub.sectionCard")}</h2>

        <Field
          label={t("adminSeoHub.defaultImage")}
          hint={t("adminSeoHub.defaultImageHint", {
            width: OG_RECOMMENDED_WIDTH,
            height: OG_RECOMMENDED_HEIGHT,
          })}
        >
          <ImageSlot
            label={t("adminSeoHub.defaultImage")}
            value={draft.default_og_image_url}
            onChange={(v) => set("default_og_image_url", v)}
            folder="social"
            accept="image/jpeg,image/png,image/webp,image/avif"
            transformFile={transformOgFile}
          />
          <p className={`mt-2 text-xs ${verdictClass}`}>{verdictMessage}</p>
        </Field>

        <Field label={t("adminSeoHub.imageAlt")} hint={t("adminSeoHub.imageAltHint")}>
          <Text
            value={draft.default_og_image_alt}
            onChange={(e) => set("default_og_image_alt", e.target.value)}
            maxLength={300}
          />
        </Field>

        <Field label={t("adminSeoHub.cardType")} hint={t("adminSeoHub.cardTypeHint")}>
          <Select
            value={draft.twitter_card_type}
            onChange={(e) =>
              set("twitter_card_type", e.target.value as SeoSettings["twitter_card_type"])
            }
          >
            <option value="summary_large_image">{t("adminSeoHub.cardTypeLarge")}</option>
            <option value="summary">{t("adminSeoHub.cardTypeSmall")}</option>
          </Select>
        </Field>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">
              {t("adminSeoHub.sectionPreviews")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("adminSeoHub.previewsHint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("adminSeoHub.previewLang")}</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {(["pl", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setPreviewLang(code)}
                  aria-pressed={previewLang === code}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    previewLang === code
                      ? "bg-brand text-brand-foreground"
                      : "text-muted-foreground hover:bg-muted/30"
                  }`}
                >
                  {/* Kod języka, nie napis - stąd `toUpperCase()` zamiast klucza. */}
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SOCIAL_NETWORKS.map((spec) => (
            <SocialCardPreview
              key={spec.id}
              spec={specFor(spec)}
              imageUrl={effectiveImage}
              title={previewTitle}
              description={previewDescription}
              host={previewHost}
              imageAlt={previewAlt}
              emptyImageLabel={t("adminSeoHub.noImage")}
            />
          ))}
        </div>

        {/* Podglądy wyżej rysują to, co WYŚLEMY; te linki pokazują, co pod tym
            adresem widzą naprawdę Google, Facebook i LinkedIn. */}
        <LivePreviewLinks className="mt-4" path={previewLang === "en" ? "en" : ""} />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-base font-semibold">{t("adminSeoHub.sectionSources")}</h2>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">{t("adminSeoHub.sourcesHint")}</p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="w-1/3 px-3 py-2 align-top font-medium">{row.where}</td>
                  <td className="px-3 py-2 align-top text-muted-foreground">{row.how}</td>
                  <td className="w-24 px-3 py-2 text-right align-top">
                    {row.to ? (
                      <Link to={row.to} className="text-brand hover:underline">
                        {t("adminSeoHub.open")}
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SaveBar saving={save.isPending} disabled={!isAdmin} onSave={() => save.mutate(draft)} />
    </div>
  );
}
