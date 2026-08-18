// /admin/settings/social-preview - jedno miejsce, w którym redakcja steruje
// obrazkami podglądu linków (og:image / twitter:image) dla CAŁEGO serwisu.
//
// Model danych: pola `default_og_image_url` / `default_og_image_alt` w blobie
// site_settings["seo"] (ten sam, którym operuje zakładka SEO). Root loader
// zapamiętuje je per host, a `buildRootHead()` / `buildContentHead()`
// (src/lib/seo/meta.ts) wstawiają jako fallback wszędzie tam, gdzie strona nie
// ma własnej okładki - stąd karta w Messengerze/LinkedIn dla strony głównej.
//
// Druga sekcja to mapa źródeł: dla każdego typu treści pokazuje, skąd
// pochodzi obrazek i linkuje do właściwego edytora, żeby nie trzeba było
// zgadywać, gdzie zmienić kartę konkretnej podstrony.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { ImageSlot, type ImageSlotTransform } from "@/components/admin/ImageSlot";
import { formatBytes } from "@/components/admin/media/lib/mediaFormat";
import { prepareOgImageFile, type OgIssue } from "@/lib/media/ogImage";
import { socialSourceRows } from "@/lib/seo/socialPreviewSources";
import { ensureI18n as ensureOgUploadI18n } from "@/lib/i18n-og-upload";
import { DEFAULT_SEO_SETTINGS, SEO_SETTINGS_KEY, type SeoSettings } from "@/lib/seo/settings";
import {
  SITE_CANONICAL_ORIGIN,
  SITE_DEFAULT_DESCRIPTION,
  SITE_DEFAULT_OG_IMAGE,
  SITE_DEFAULT_TITLE,
} from "@/lib/seo/meta";

export const Route = createFileRoute("/admin/settings/social-preview")({
  component: SocialPreviewTab,
  head: () => ({ meta: [{ title: "Podgląd linków - Ustawienia" }] }),
});

function SocialPreviewTab() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-og-upload.ts.
  ensureOgUploadI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const { query, save } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const [draft, setDraft] = useDraft<SeoSettings>(query.data);

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

  const effectiveImage = draft.default_og_image_url.trim()
    ? draft.default_og_image_url.trim()
    : `${SITE_CANONICAL_ORIGIN}${SITE_DEFAULT_OG_IMAGE}`;

  const rows = socialSourceRows(lang);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{t("admin.socialPreview.title")}</h2>
      <p className="text-xs text-muted-foreground mb-4">{t("admin.socialPreview.subtitle")}</p>

      <Field
        label={t("admin.socialPreview.defaultImage")}
        hint={t("admin.socialPreview.defaultImageHint", { file: SITE_DEFAULT_OG_IMAGE })}
      >
        <ImageSlot
          label={t("admin.socialPreview.defaultImage")}
          value={draft.default_og_image_url}
          onChange={(v) => set("default_og_image_url", v)}
          folder="social"
          accept="image/jpeg,image/png,image/webp,image/avif"
          transformFile={transformOgFile}
        />
      </Field>

      <Field label={t("admin.socialPreview.alt")} hint={t("admin.socialPreview.altHint")}>
        <Text
          value={draft.default_og_image_alt}
          onChange={(e) => set("default_og_image_alt", e.target.value)}
          maxLength={300}
        />
      </Field>

      <h3 className="text-sm font-semibold mt-6 mb-2">{t("admin.socialPreview.previewTitle")}</h3>
      <div className="max-w-md overflow-hidden rounded-lg border border-border bg-muted/40">
        <div className="aspect-[1200/630] w-full bg-muted">
          <img
            src={effectiveImage}
            alt={draft.default_og_image_alt || t("admin.socialPreview.previewAlt")}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
        <div className="space-y-1 p-3">
          <p className="line-clamp-2 text-sm font-semibold">{SITE_DEFAULT_TITLE[lang]}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {SITE_DEFAULT_DESCRIPTION[lang]}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {new URL(SITE_CANONICAL_ORIGIN).host}
          </p>
        </div>
      </div>

      <h3 className="text-sm font-semibold mt-8 mb-2">{t("admin.socialPreview.sourcesTitle")}</h3>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="w-1/3 px-3 py-2 font-medium align-top">{row.where}</td>
                <td className="px-3 py-2 text-muted-foreground align-top">{row.how}</td>
                <td className="w-24 px-3 py-2 text-right align-top">
                  {row.to ? (
                    <Link to={row.to} className="text-brand hover:underline">
                      {t("admin.socialPreview.open")}
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
