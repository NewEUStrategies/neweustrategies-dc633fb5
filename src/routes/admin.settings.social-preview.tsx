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
import { ImageSlot } from "@/components/admin/ImageSlot";
import {
  DEFAULT_SEO_SETTINGS,
  SEO_SETTINGS_KEY,
  type SeoSettings,
} from "@/lib/seo/settings";
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

type SourceRow = { id: string; where: string; how: string; to?: string };

function SocialPreviewTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const { query, save } = useSettings<SeoSettings>(SEO_SETTINGS_KEY, DEFAULT_SEO_SETTINGS);
  const [draft, setDraft] = useDraft<SeoSettings>(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof SeoSettings>(k: K, v: SeoSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  const effectiveImage = draft.default_og_image_url.trim()
    ? draft.default_og_image_url.trim()
    : `${SITE_CANONICAL_ORIGIN}${SITE_DEFAULT_OG_IMAGE}`;

  const rows: SourceRow[] = [
    {
      id: "home",
      where: lang === "pl" ? "Strona główna i listingi" : "Homepage & listings",
      how:
        lang === "pl"
          ? "Domyślna karta ustawiona powyżej."
          : "The default card configured above.",
    },
    {
      id: "posts",
      where: lang === "pl" ? "Wpisy / artykuły" : "Posts / articles",
      how:
        lang === "pl"
          ? "Obrazek wyróżniający wpisu; nadpisanie w panelu SEO edytora."
          : "The post cover image; override in the editor's SEO panel.",
      to: "/admin/posts",
    },
    {
      id: "pages",
      where: lang === "pl" ? "Strony (także kodowe </>)" : "Pages (incl. code pages </>)",
      how:
        lang === "pl"
          ? "Pole „Obrazek OG” w SEO danej strony."
          : "The \"OG image\" field in the page's SEO section.",
      to: "/admin/pages",
    },
    {
      id: "authors",
      where: lang === "pl" ? "Profile autorów i ekspertów" : "Author & expert profiles",
      how:
        lang === "pl"
          ? "Awatar profilu (z automatycznym cache-busterem)."
          : "The profile avatar (with an automatic cache-buster).",
      to: "/admin/experts",
    },
    {
      id: "podcasts",
      where: lang === "pl" ? "Podcasty i web stories" : "Podcasts & web stories",
      how:
        lang === "pl"
          ? "Okładka odcinka / historii; brak = karta domyślna."
          : "Episode / story cover; missing = the default card.",
      to: "/admin/podcasts",
    },
    {
      id: "newsletter",
      where: lang === "pl" ? "Newsletter i popupy" : "Newsletter & popups",
      how:
        lang === "pl"
          ? "Własne obrazy w kreatorze wiadomości i popupów."
          : "Own images in the message and popup builders.",
      to: "/admin/popups",
    },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">
        {t("admin.socialPreview.title", {
          defaultValue: lang === "pl" ? "Podgląd linków (og:image)" : "Link preview (og:image)",
        })}
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        {t("admin.socialPreview.subtitle", {
          defaultValue:
            lang === "pl"
              ? "Obrazek, który widzą odbiorcy po wklejeniu linku w Messengerze, WhatsAppie, LinkedIn, X czy Slacku. Zalecany format: 1200x630 px, JPG/PNG, poniżej 1 MB."
              : "The image people see when your link is pasted into Messenger, WhatsApp, LinkedIn, X or Slack. Recommended: 1200x630 px, JPG/PNG, under 1 MB.",
        })}
      </p>

      <Field
        label={t("admin.socialPreview.defaultImage", {
          defaultValue: lang === "pl" ? "Domyślna karta" : "Default card",
        })}
        hint={t("admin.socialPreview.defaultImageHint", {
          defaultValue:
            lang === "pl"
              ? `Puste pole = wbudowany plik marki (${SITE_DEFAULT_OG_IMAGE}). Po zmianie odśwież podgląd w narzędziu dostawcy - platformy cache'ują karty nawet kilka dni.`
              : `Empty = the built-in brand file (${SITE_DEFAULT_OG_IMAGE}). After a change, re-scrape the link - platforms cache cards for days.`,
        })}
      >
        <ImageSlot
          label={t("admin.socialPreview.defaultImage", {
            defaultValue: lang === "pl" ? "Domyślna karta" : "Default card",
          })}
          value={draft.default_og_image_url}
          onChange={(v) => set("default_og_image_url", v)}
          folder="social"
        />
      </Field>

      <Field
        label={t("admin.socialPreview.alt", {
          defaultValue: lang === "pl" ? "Opis alternatywny (alt)" : "Alternative text (alt)",
        })}
        hint={t("admin.socialPreview.altHint", {
          defaultValue:
            lang === "pl"
              ? "Czytany przez czytniki ekranu i część scraperów jako og:image:alt."
              : "Read by screen readers and some scrapers as og:image:alt.",
        })}
      >
        <Text
          value={draft.default_og_image_alt}
          onChange={(e) => set("default_og_image_alt", e.target.value)}
          maxLength={300}
        />
      </Field>

      <h3 className="text-sm font-semibold mt-6 mb-2">
        {t("admin.socialPreview.previewTitle", {
          defaultValue: lang === "pl" ? "Podgląd karty" : "Card preview",
        })}
      </h3>
      <div className="max-w-md overflow-hidden rounded-lg border border-border bg-muted/40">
        <div className="aspect-[1200/630] w-full bg-muted">
          <img
            src={effectiveImage}
            alt={
              draft.default_og_image_alt ||
              t("admin.socialPreview.previewAlt", { defaultValue: "Podgląd karty" })
            }
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

      <h3 className="text-sm font-semibold mt-8 mb-2">
        {t("admin.socialPreview.sourcesTitle", {
          defaultValue:
            lang === "pl" ? "Skąd bierze się obrazek każdej strony" : "Where each page's image comes from",
        })}
      </h3>
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
                      {t("admin.socialPreview.open", {
                        defaultValue: lang === "pl" ? "Otwórz" : "Open",
                      })}
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

