// Organism: the Yoast-class SEO panel embedded in the post/page editors.
// Bilingual (PL/EN tabs, mirroring the content model), with a live Google SERP
// preview driven by the exact resolution chain the public head() uses, pixel
// meters, canonical/noindex controls, a social-image override and the
// generator of branded 1200x630 OG cards (canvas-rendered in the browser,
// uploaded to the media bucket).
import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastError } from "@/lib/toastError";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ImageSlot } from "@/components/admin/ImageSlot";
import { SerpPreview } from "@/components/admin/seo/SerpPreview";
import { LivePreviewLinks } from "@/components/admin/seo/LivePreviewLinks";
import { SeoTextField } from "@/components/admin/seo/SeoTextField";
import { SeoValidationSummary } from "@/components/admin/seo/SeoValidationSummary";
import { Loader2, Search, Sparkles } from "@/lib/lucide-shim";
import { applyTitleSuffix, resolveSocialImage, type SeoFieldsRow } from "@/lib/seo/fields";
import { SITE_NAME } from "@/lib/seo/meta";
import { metaDescription } from "@/lib/routing/publicSegments";
import { validateSeoPanel, type SeoIssue } from "@/lib/seo/validation";
import {
  analyzeHeadings,
  hasReadableText,
  type HeadingIssue,
  type HeadingIssueLang,
  type ValidateHeadingsOptions,
} from "@/lib/seo/headingValidation";
import {
  DEFAULT_SEO_SETTINGS,
  effectiveTitleSuffix,
  SEO_SETTINGS_KEY,
  SeoSettingsSchema,
  type SeoSettings,
} from "@/lib/seo/settings";
import { generateAndUploadOgCard } from "@/lib/seo/ogCardCanvas";
import { UrlInspectionWidget } from "@/components/admin/seo/UrlInspectionWidget";
import { useSiteSetting } from "@/lib/useSiteSetting";
import { useTenantPublicOrigin } from "@/lib/seo/useTenantPublicOrigin";
import { displayHost } from "@/lib/seo/socialNetworks";

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
  /** Body HTML per language for the heading-structure validator. */
  contentHtml?: { pl: string | null; en: string | null };
  /** Block tree (jsonb) - if set, wins over `contentHtml` for heading scanning. */
  contentBlocks?: unknown;
  /** Emits the current validation snapshot so save handlers can preflight. */
  onIssuesChange?: (issues: SeoIssue[]) => void;
}

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 320;
// Both post and page layouts render the primary title as <h1> outside the
// block editor: body H1s are duplicates (not "missing"), and the hierarchy
// check starts from that layout H1.
const HEADING_OPTIONS: ValidateHeadingsOptions = { rendersTitleAsH1: true };
// `validateSeoPanel` reads ONLY the four title/description overrides from
// `value`. The memo below depends on exactly those strings (editors pass a
// fresh `value={{...}}` literal on every render) and hands the validator a
// value whose remaining fields are these neutral constants - so a field the
// memo does not track cannot influence the result. SeoPanel.test.tsx pins the
// set of fields the validator actually reads; if it grows, that test fails.
const VALIDATION_UNTRACKED: Omit<
  SeoPanelValue,
  "seo_title_pl" | "seo_title_en" | "seo_description_pl" | "seo_description_en"
> = {
  seo_canonical_url: null,
  seo_noindex: false,
  seo_og_image_url: null,
  og_image_generated_url: null,
};

export function SeoPanel(props: SeoPanelProps) {
  const { value, onChange, entity, slug, pathSourcePageId, onIssuesChange } = props;
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<"pl" | "en">(i18n.language === "en" ? "en" : "pl");
  const [generating, setGenerating] = useState(false);
  const noindexId = useId();
  // Host in the SERP preview = the host this tenant's links resolve to (same
  // rule as /admin/seo/homepage and the machine surfaces). Without it a tenant
  // on its own domain saw the brand host above its own post. A tenant with no
  // public address (`null`, see LivePreviewLinks) gets an empty host rather
  // than the brand's - SerpPreview falls back to the brand only on `undefined`.
  const tenantOrigin: string | null = useTenantPublicOrigin();
  const previewHost = tenantOrigin ? displayHost(tenantOrigin) : "";

  const seoSettings: SeoSettings = useSiteSetting(
    SEO_SETTINGS_KEY,
    DEFAULT_SEO_SETTINGS,
    SeoSettingsSchema,
  );
  // Sufiks marki doklejany do tytułu WYPROWADZONEGO - walidator i pole tytułu
  // mierzą tekst z sufiksem, bo taki trafia do Google (head(), podgląd SERP).
  const titleSuffix = effectiveTitleSuffix(seoSettings);

  const fallbackTitlePl = props.fallbackTitle.pl;
  const fallbackTitleEn = props.fallbackTitle.en;
  const fallbackDescPl = props.fallbackDescription.pl;
  const fallbackDescEn = props.fallbackDescription.en;
  const seoTitlePl = value.seo_title_pl;
  const seoTitleEn = value.seo_title_en;
  const seoDescPl = value.seo_description_pl;
  const seoDescEn = value.seo_description_en;
  const issues = useMemo(
    () =>
      validateSeoPanel({
        value: {
          ...VALIDATION_UNTRACKED,
          seo_title_pl: seoTitlePl,
          seo_title_en: seoTitleEn,
          seo_description_pl: seoDescPl,
          seo_description_en: seoDescEn,
        },
        fallbackTitle: { pl: fallbackTitlePl, en: fallbackTitleEn },
        fallbackDescription: { pl: fallbackDescPl, en: fallbackDescEn },
        slug,
        titleCharLimit: TITLE_MAX,
        descriptionCharLimit: DESCRIPTION_MAX,
        titleSuffix,
      }),
    [
      seoTitlePl,
      seoTitleEn,
      seoDescPl,
      seoDescEn,
      fallbackTitlePl,
      fallbackTitleEn,
      fallbackDescPl,
      fallbackDescEn,
      slug,
      titleSuffix,
    ],
  );

  // Heading scan per language, memoised on the STRINGS, not on the
  // `contentHtml` object: editors pass a fresh `{ pl, en }` literal on every
  // render, so an object dependency re-scanned both bodies on every keystroke
  // anywhere in the form. Typing in the PL body now re-scans only PL.
  const blocks = props.contentBlocks;
  const htmlPl = props.contentHtml?.pl ?? null;
  const htmlEn = props.contentHtml?.en ?? null;
  const headingsPl = useMemo(
    () => analyzeHeadings("pl", { html: htmlPl, blocks }, HEADING_OPTIONS),
    [htmlPl, blocks],
  );
  const headingsEn = useMemo(
    () => analyzeHeadings("en", { html: htmlEn, blocks }, HEADING_OPTIONS),
    [htmlEn, blocks],
  );
  const headingIssues = useMemo<HeadingIssue[]>(
    () => [...headingsPl.issues, ...headingsEn.issues],
    [headingsPl, headingsEn],
  );
  // No headings = nothing was checked; the summary must say so instead of
  // presenting the empty issue list as a pass. A language with NO content at
  // all (typically a post without an EN translation) is not an unrun check -
  // it is simply not written yet - so it is left out, unless no language has
  // any content (a fresh draft: then every language is honestly "unchecked").
  const hasTextPl = useMemo(() => hasReadableText(htmlPl), [htmlPl]);
  const hasTextEn = useMemo(() => hasReadableText(htmlEn), [htmlEn]);
  const uncheckedHeadingLangs = useMemo<HeadingIssueLang[]>(() => {
    const anyText = hasTextPl || hasTextEn;
    const langs: HeadingIssueLang[] = [];
    if (headingsPl.headingCount === 0 && (hasTextPl || !anyText)) langs.push("pl");
    if (headingsEn.headingCount === 0 && (hasTextEn || !anyText)) langs.push("en");
    return langs;
  }, [headingsPl, headingsEn, hasTextPl, hasTextEn]);

  const issuesKey = useMemo(
    () => issues.map((i) => `${i.lang}:${i.kind}:${i.severity}:${i.chars}:${i.px}`).join("|"),
    [issues],
  );
  useEffect(() => {
    onIssuesChange?.(issues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issuesKey, onIssuesChange]);

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
    ? t("admin.seo.og.sourceOverride")
    : props.coverImageUrl
      ? t("admin.seo.og.sourceCover")
      : value.og_image_generated_url
        ? t("admin.seo.og.sourceCard")
        : t("admin.seo.og.sourceDefault");

  const generateCard = async () => {
    const title =
      (tab === "en" ? value.seo_title_en : value.seo_title_pl)?.trim() ||
      (tab === "en"
        ? props.fallbackTitle.en || props.fallbackTitle.pl
        : props.fallbackTitle.pl || props.fallbackTitle.en);
    if (!title) {
      toast.error(t("admin.seo.og.needTitle"));
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
      toast.success(t("admin.seo.og.generated"));
    } catch (e) {
      toastError(e);
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
    const documentTitle = applyTitleSuffix(resolvedTitle, titleSuffix, titleOverride !== null);
    const resolvedDescription =
      (lang === "en" ? value.seo_description_en : value.seo_description_pl)?.trim() ||
      fallbackDescription;
    return (
      <div className="space-y-4">
        <SerpPreview
          title={documentTitle}
          description={resolvedDescription}
          host={previewHost}
          path={lang === "en" ? `en/${previewPath}` : previewPath}
          noindex={value.seo_noindex}
        />
        {/* Rzeczywisty adres tej treści plus wyjścia do Google, Facebooka
            i LinkedIna - każde w nowym oknie. */}
        <LivePreviewLinks path={lang === "en" ? `en/${previewPath}` : previewPath} />
        <SeoTextField
          label={t("admin.seo.titleLabel")}
          kind="title"
          value={lang === "en" ? value.seo_title_en : value.seo_title_pl}
          fallback={fallbackTitle}
          measuredFallback={applyTitleSuffix(fallbackTitle, titleSuffix, false)}
          maxLength={TITLE_MAX}
          onChange={(v) => onChange({ [titleKey]: v } as Partial<SeoPanelValue>)}
        />
        <SeoTextField
          label={t("admin.seo.descriptionLabel")}
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
          {t("admin.seo.panelTitle")}
        </h3>
        <span className="text-[10px] text-muted-foreground">{t("admin.seo.panelHint")}</span>
      </div>

      <SeoValidationSummary
        issues={issues}
        headingIssues={headingIssues}
        uncheckedHeadingLangs={uncheckedHeadingLangs}
      />

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
          <Label>{t("admin.seo.canonicalLabel")}</Label>
          <Input
            value={value.seo_canonical_url ?? ""}
            placeholder="https://…"
            onChange={(e) => onChange({ seo_canonical_url: e.target.value.trim() || null })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">{t("admin.seo.canonicalHint")}</p>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
          <div>
            {/* Nazwa przełącznika = widoczna etykieta (`aria-labelledby`),
                opis = podpowiedź; `htmlFor` dodatkowo czyni etykietę klikalną. */}
            <Label id={`${noindexId}-label`} htmlFor={noindexId}>
              {t("admin.seo.noindexLabel")}
            </Label>
            <p id={`${noindexId}-hint`} className="text-[10px] text-muted-foreground mt-1">
              {t("admin.seo.noindexHint")}
            </p>
          </div>
          <Switch
            id={noindexId}
            aria-labelledby={`${noindexId}-label`}
            aria-describedby={`${noindexId}-hint`}
            checked={value.seo_noindex}
            onCheckedChange={(checked) => onChange({ seo_noindex: checked })}
          />
        </div>
      </div>

      <div className="pt-2 border-t border-border space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{t("admin.seo.og.title")}</h4>
          <span className="text-[10px] text-muted-foreground">{socialImageSource}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="aspect-[1200/630] rounded-md border border-border bg-muted/40 overflow-hidden grid place-items-center">
              {socialImage ? (
                <img src={socialImage} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground px-4 text-center">
                  {t("admin.seo.og.empty")}
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
              {t("admin.seo.og.generate")}
            </Button>
          </div>
          <ImageSlot
            label={t("admin.seo.og.overrideLabel")}
            hint={t("admin.seo.og.overrideHint")}
            value={value.seo_og_image_url ?? ""}
            onChange={(v) => onChange({ seo_og_image_url: v.trim() || null })}
            folder="og-cards"
          />
        </div>
      </div>

      <div className="pt-2 border-t border-border">
        <UrlInspectionWidget path={previewPath} lang={tab} />
      </div>
    </div>
  );
}
