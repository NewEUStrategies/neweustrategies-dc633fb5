// Organism: the Yoast-class SEO panel embedded in the post/page editors.
// Bilingual (PL/EN tabs, mirroring the content model), with a live Google SERP
// preview driven by the exact resolution chain the public head() uses, pixel
// meters, canonical/noindex controls, a social-image override and the
// generator of branded 1200x630 OG cards (canvas-rendered in the browser,
// uploaded to the media bucket).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ImageSlot } from "@/components/admin/ImageSlot";
import { SerpPreview } from "@/components/admin/seo/SerpPreview";
import { SeoTextField } from "@/components/admin/seo/SeoTextField";
import { SeoValidationSummary } from "@/components/admin/seo/SeoValidationSummary";
import { Loader2, Search, Sparkles } from "@/lib/lucide-shim";
import { applyTitleSuffix, resolveSocialImage, type SeoFieldsRow } from "@/lib/seo/fields";
import { SITE_NAME } from "@/lib/seo/meta";
import { metaDescription } from "@/lib/routing/publicSegments";
import { validateSeoPanel, type SeoIssue } from "@/lib/seo/validation";
import {
  DEFAULT_SEO_SETTINGS,
  effectiveTitleSuffix,
  SEO_SETTINGS_KEY,
  SeoSettingsSchema,
  type SeoSettings,
} from "@/lib/seo/settings";
import { generateAndUploadOgCard } from "@/lib/seo/ogCardCanvas";
import { useSiteSetting } from "@/lib/useSiteSetting";

export interface SeoPanelValue {
  seo_title_pl: string | null;
  seo_title_en: string | null;
  seo_description_pl: string | null;
  seo_description_en: string | null;
  seo_canonical_url: string | null;
  seo_noindex: boolean;
  seo_og_image_url: string | null;
  og_image_generated_url: string | null;
}

interface SeoPanelProps {
  value: SeoPanelValue;
  onChange: (patch: Partial<SeoPanelValue>) => void;
  entity: { kind: "post" | "page"; id: string };
  slug: string;
  /** Post: parent page id (URL = parent path + slug). Page: its own id. */
  pathSourcePageId: string | null;
  /** Derived titles per language (the content titles). */
  fallbackTitle: { pl: string; en: string };
  /** Derived descriptions per language (excerpts). */
  fallbackDescription: { pl: string | null; en: string | null };
  coverImageUrl: string | null;
  /** Kicker printed on the generated OG card (e.g. section name). */
  ogKicker?: string | null;
  /** Emits the current validation snapshot so save handlers can preflight. */
  onIssuesChange?: (issues: SeoIssue[]) => void;
}

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 320;

export function SeoPanel(props: SeoPanelProps) {
  const { value, onChange, entity, slug, pathSourcePageId, onIssuesChange } = props;
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<"pl" | "en">(i18n.language === "en" ? "en" : "pl");
  const [generating, setGenerating] = useState(false);

  const issues = useMemo(
    () =>
      validateSeoPanel({
        value,
        fallbackTitle: props.fallbackTitle,
        fallbackDescription: props.fallbackDescription,
        slug,
        titleCharLimit: TITLE_MAX,
        descriptionCharLimit: DESCRIPTION_MAX,
      }),
    [value, props.fallbackTitle, props.fallbackDescription, slug],
  );

  useEffect(() => {
    onIssuesChange?.(issues);
  }, [issues, onIssuesChange]);
  const seoSettings: SeoSettings = useSiteSetting(
    SEO_SETTINGS_KEY,
    DEFAULT_SEO_SETTINGS,
    SeoSettingsSchema,
  );

  // URL path shown in the SERP preview (parent page path resolved via RPC).
  const { data: basePath } = useQuery({
    queryKey: ["seo-panel-path", entity.kind, pathSourcePageId],
    enabled: !!pathSourcePageId,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      if (!pathSourcePageId) return null;
      const { data } = await supabase.rpc("page_full_path", { _page_id: pathSourcePageId });
      return typeof data === "string" ? data : null;
    },
  });
  const previewPath = entity.kind === "post" ? `${basePath ?? "…"}/${slug}` : (basePath ?? slug);

  const seoRow: SeoFieldsRow = value;
  const socialImage = resolveSocialImage(seoRow, props.coverImageUrl);
  const socialImageSource = value.seo_og_image_url
    ? t("admin.seo.og.sourceOverride", { defaultValue: "Własny obrazek" })
    : props.coverImageUrl
      ? t("admin.seo.og.sourceCover", { defaultValue: "Okładka wpisu" })
      : value.og_image_generated_url
        ? t("admin.seo.og.sourceCard", { defaultValue: "Wygenerowana karta" })
        : t("admin.seo.og.sourceDefault", { defaultValue: "Domyślny obrazek serwisu" });

  const generateCard = async () => {
    const title =
      (tab === "en" ? value.seo_title_en : value.seo_title_pl)?.trim() ||
      (tab === "en"
        ? props.fallbackTitle.en || props.fallbackTitle.pl
        : props.fallbackTitle.pl || props.fallbackTitle.en);
    if (!title) {
      toast.error(t("admin.seo.og.needTitle", { defaultValue: "Najpierw uzupełnij tytuł" }));
      return;
    }
    setGenerating(true);
    try {
      const url = await generateAndUploadOgCard(entity.kind, entity.id, {
        title,
        kicker: props.ogKicker ?? null,
        siteName: SITE_NAME,
      });
      onChange({ og_image_generated_url: url });
      toast.success(t("admin.seo.og.generated", { defaultValue: "Karta OG wygenerowana" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const langSection = (lang: "pl" | "en") => {
    const fallbackTitle =
      (lang === "en"
        ? props.fallbackTitle.en || props.fallbackTitle.pl
        : props.fallbackTitle.pl || props.fallbackTitle.en) || slug;
    const fallbackDescription = metaDescription(
      lang === "en"
        ? props.fallbackDescription.en || props.fallbackDescription.pl
        : props.fallbackDescription.pl || props.fallbackDescription.en,
      fallbackTitle,
    );
    const titleKey = lang === "en" ? "seo_title_en" : "seo_title_pl";
    const descKey = lang === "en" ? "seo_description_en" : "seo_description_pl";
    const titleOverride = (lang === "en" ? value.seo_title_en : value.seo_title_pl)?.trim() || null;
    const resolvedTitle = titleOverride ?? fallbackTitle;
    const documentTitle = applyTitleSuffix(
      resolvedTitle,
      effectiveTitleSuffix(seoSettings),
      titleOverride !== null,
    );
    const resolvedDescription =
      (lang === "en" ? value.seo_description_en : value.seo_description_pl)?.trim() ||
      fallbackDescription;
    return (
      <div className="space-y-4">
        <SerpPreview
          title={documentTitle}
          description={resolvedDescription}
          path={lang === "en" ? `en/${previewPath}` : previewPath}
          noindex={value.seo_noindex}
        />
        <SeoTextField
          label={t("admin.seo.titleLabel", { defaultValue: "Tytuł SEO" })}
          kind="title"
          value={lang === "en" ? value.seo_title_en : value.seo_title_pl}
          fallback={fallbackTitle}
          maxLength={TITLE_MAX}
          onChange={(v) => onChange({ [titleKey]: v } as Partial<SeoPanelValue>)}
        />
        <SeoTextField
          label={t("admin.seo.descriptionLabel", { defaultValue: "Opis meta (description)" })}
          kind="description"
          value={lang === "en" ? value.seo_description_en : value.seo_description_pl}
          fallback={fallbackDescription}
          maxLength={DESCRIPTION_MAX}
          onChange={(v) => onChange({ [descKey]: v } as Partial<SeoPanelValue>)}
        />
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold inline-flex items-center gap-2">
          <Search className="w-4 h-4" />
          {t("admin.seo.panelTitle", { defaultValue: "SEO i podgląd w Google" })}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {t("admin.seo.panelHint", {
            defaultValue: "Puste pola = wartości domyślne z tytułu i zajawki",
          })}
        </span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v === "en" ? "en" : "pl")}>
        <TabsList className="grid w-full max-w-[200px] grid-cols-2">
          <TabsTrigger value="pl">PL</TabsTrigger>
          <TabsTrigger value="en">EN</TabsTrigger>
        </TabsList>
        <TabsContent value="pl" className="mt-4">
          {langSection("pl")}
        </TabsContent>
        <TabsContent value="en" className="mt-4">
          {langSection("en")}
        </TabsContent>
      </Tabs>

      <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-border">
        <div>
          <Label>
            {t("admin.seo.canonicalLabel", { defaultValue: "Canonical URL (nadpisanie)" })}
          </Label>
          <Input
            value={value.seo_canonical_url ?? ""}
            placeholder="https://…"
            onChange={(e) => onChange({ seo_canonical_url: e.target.value.trim() || null })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {t("admin.seo.canonicalHint", {
              defaultValue: "Tylko dla treści przedrukowanych - wskazuje oryginalne źródło.",
            })}
          </p>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
          <div>
            <Label>
              {t("admin.seo.noindexLabel", {
                defaultValue: "Ukryj przed wyszukiwarkami (noindex)",
              })}
            </Label>
            <p className="text-[10px] text-muted-foreground mt-1">
              {t("admin.seo.noindexHint", {
                defaultValue: "Usuwa też adres z sitemap, RSS i news-sitemap.",
              })}
            </p>
          </div>
          <Switch
            checked={value.seo_noindex}
            onCheckedChange={(checked) => onChange({ seo_noindex: checked })}
          />
        </div>
      </div>

      <div className="pt-2 border-t border-border space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">
            {t("admin.seo.og.title", { defaultValue: "Obrazek udostępniania (OG)" })}
          </h4>
          <span className="text-[10px] text-muted-foreground">{socialImageSource}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="aspect-[1200/630] rounded-md border border-border bg-muted/40 overflow-hidden grid place-items-center">
              {socialImage ? (
                <img src={socialImage} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground px-4 text-center">
                  {t("admin.seo.og.empty", {
                    defaultValue: "Brak obrazka - użyty będzie domyślny",
                  })}
                </span>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={generateCard}
              disabled={generating}
            >
              {generating ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1.5" />
              )}
              {t("admin.seo.og.generate", { defaultValue: "Generuj brandowaną kartę 1200x630" })}
            </Button>
          </div>
          <ImageSlot
            label={t("admin.seo.og.overrideLabel", {
              defaultValue: "Własny obrazek OG (nadpisanie)",
            })}
            hint={t("admin.seo.og.overrideHint", {
              defaultValue:
                "Ma pierwszeństwo przed okładką i wygenerowaną kartą. Zalecane 1200x630.",
            })}
            value={value.seo_og_image_url ?? ""}
            onChange={(v) => onChange({ seo_og_image_url: v.trim() || null })}
            folder="og-cards"
          />
        </div>
      </div>
    </div>
  );
}
