// Organism: slider widget editor (variant grid + slide list + live preview).
import { toJson } from "@/lib/builder/types";
import { Image as ImageIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PropField } from "../../atoms";
import { AuthorDisplayControl } from "../../molecules/AuthorDisplayControl";
import { ImageSlot } from "./ImageSlot";
import { PostPicker } from "./PostPicker";
import { TaxonomyPicker } from "./TaxonomyPicker";
import {
  SLIDER_VARIANTS,
  SliderRender,
  NAV_ARROW_VARIANTS,
  NAV_ARROW_VARIANT_VALUES,
  NAV_BG_STYLES,
  NAV_POSITIONS,
  SLIDER_RATIOS,
  SLIDER_ROUNDED_VALUES,
  SLIDER_VARIANT_VALUES,
  type SliderConfig,
  type SliderItem,
} from "@/lib/builder/sliderVariants";
import { asBool, asNum, asNumInRange, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { resolveAuthorDisplay } from "@/lib/builder/authorDisplay";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import { useBuilderLabel } from "@/lib/builder/labelsEn";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function SliderEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const bl = useBuilderLabel();
  // Wszystkie odczyty przez contentValue - panel commituje raz boolean, raz
  // string ("0"/"1"), a stare dokumenty trzymają liczby w stringach.
  const variant = asOneOf(c.variant, SLIDER_VARIANT_VALUES, "editorial-hero");
  const ratio = asOneOf(c.ratio, SLIDER_RATIOS, "16/9");
  const autoplay = asBool(c.autoplay, true);
  const intervalMs = asNum(c.intervalMs, 4500);
  const rounded = asOneOf(c.rounded, SLIDER_ROUNDED_VALUES, "md");
  const overlayOpacity = asNumInRange(c.overlayOpacity, 0.45, 0, 1);
  const source = asOneOf(c.source, ["manual", "posts"] as const, "manual");
  const limit = asNum(c.limit, 5);
  const categorySlugs = asStr(c.categorySlugs);
  const tagSlugs = asStr(c.tagSlugs);
  const excludeIds = asStr(c.excludeIds);
  const orderBy = asOneOf(c.orderBy, ["newest", "oldest", "title"] as const, "newest");
  const showExcerpt = asBool(c.showExcerpt, true);
  const showCover = asBool(c.showCover, true);
  const showTitle = asBool(c.showTitle, true);
  // Autor: ten sam rezolwer, co renderer i podgląd - dzięki temu podgląd na
  // żywo nie może pokazać innego stanu niż kanwa i strona publiczna.
  const author = resolveAuthorDisplay(c, lang);

  const ctaKey = `cta_${lang}` as const;
  const ctaValue = asStr(c[ctaKey]);
  const titleSizePx = asNum(c.titleSizePx, 0);
  const titleWeight = asNum(c.titleWeight, 700);
  const subtitleSizePx = asNum(c.subtitleSizePx, 0);
  const subtitleWeight = asNum(c.subtitleWeight, 400);
  const columns = Math.round(asNumInRange(c.columns, 3, 1, 4)) as 1 | 2 | 3 | 4;

  // Navigation buttons style
  const navSizePx = asNumInRange(c.navSizePx, 52, 28, 96);
  const navRoundedPx = asNum(c.navRoundedPx, 999);
  const navBgColor = asStr(c.navBgColor) || "#ffffff";
  const navArrowColor = asStr(c.navArrowColor) || "#ffffff";
  const navBgStyle = asOneOf(c.navBgStyle, NAV_BG_STYLES, "glass");
  const navPosition = asOneOf(c.navPosition, NAV_POSITIONS, "mid");
  const navArrowVariant = asOneOf(c.navArrowVariant, NAV_ARROW_VARIANT_VALUES, "chevron");
  const navArrowStroke = asNumInRange(c.navArrowStroke, 2.25, 0.5, 4);

  const rawItems = Array.isArray(c.items) ? (c.items as unknown[]) : [];
  const items: SliderItem[] = rawItems
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((it) => ({
      image: asStr(it.image),
      postId: asStr(it.postId) || undefined,
      title_pl: asStr(it.title_pl),
      title_en: asStr(it.title_en),
      subtitle_pl: asStr(it.subtitle_pl),
      subtitle_en: asStr(it.subtitle_en),
      href: asStr(it.href),
      cta_pl: asStr(it.cta_pl),
      cta_en: asStr(it.cta_en),
      category_pl: asStr(it.category_pl),
      category_en: asStr(it.category_en),
      categoryColor: asStr(it.categoryColor),
      author: asStr(it.author),
      // Awatar i slug autora nie mają własnych kontrolek (pochodzą z podpiętego
      // wpisu), ale muszą przetrwać mapowanie - inaczej każda edycja slajdu
      // kasowała je z dokumentu, a podgląd rysował sam inicjał.
      authorAvatar: asStr(it.authorAvatar),
      authorSlug: asStr(it.authorSlug),
      readTime: asStr(it.readTime),
    }));

  const updateItems = (next: SliderItem[]) => setContent("items", toJson(next));
  const updateItem = (i: number, patch: Partial<SliderItem>) => {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    updateItems(next);
  };
  const addItem = () =>
    updateItems([
      ...items,
      {
        image: "",
        title_pl: "",
        title_en: "",
        subtitle_pl: "",
        subtitle_en: "",
        href: "",
        cta_pl: "",
        cta_en: "",
      },
    ]);
  const removeItem = (i: number) => updateItems(items.filter((_, j) => j !== i));
  const moveItem = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    updateItems(next);
  };

  // Fallback preview items pulled from real published posts so editors see
  // actual titles/excerpts (not "Pierwszy/Drugi slajd").
  const { data: demoItems = [] } = useQuery({
    queryKey: ["slider-editor-demo-posts"] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SliderItem[]> => {
      const { data } = await supabase
        .from("posts")
        .select("slug,cover_image_url,title_pl,title_en,excerpt_pl,excerpt_en")
        .eq("status", "published")
        .is("deleted_at", null)
        .not("cover_image_url", "is", null)
        .order("published_at", { ascending: false })
        .limit(5);
      return (data ?? []).map((p) => ({
        image: p.cover_image_url ?? "",
        title_pl: p.title_pl ?? "",
        title_en: p.title_en ?? "",
        subtitle_pl: p.excerpt_pl ?? "",
        subtitle_en: p.excerpt_en ?? "",
        href: `/post/${p.slug}`,
      }));
    },
  });
  const hasRealItems = items.some((it) => it.image);
  const previewCfg: SliderConfig = {
    variant,
    ratio,
    autoplay: true,
    intervalMs,
    rounded,
    overlayOpacity,
    columns,
    titleSizePx: titleSizePx > 0 ? titleSizePx : undefined,
    titleWeight,
    subtitleSizePx: subtitleSizePx > 0 ? subtitleSizePx : undefined,
    subtitleWeight,
    // Podgląd MUSI dostać komplet sekcji "Wyświetlanie" - inaczej redakcja
    // widzi tu jedno, a na kanwie i stronie publicznej drugie.
    showExcerpt,
    showAuthor: author.visible,
    showTitle,
    showCover,
    showAuthorName: author.showName,
    showAuthorAvatar: author.showAvatar,
    authorLabel_pl: asStr(c.authorLabel_pl),
    authorLabel_en: asStr(c.authorLabel_en),
    authorSizePx: author.nameSizePx,
    authorAvatarSizePx: author.avatarSizePx,

    navSizePx,
    navRoundedPx,
    navBgColor,
    navArrowColor,
    navBgStyle,
    navPosition,
    navArrowVariant,
    navArrowStroke,
    items: hasRealItems ? items : demoItems,
  };

  return (
    <div className="space-y-4">
      {/* Variant picker */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("builder.sliderEditor.variant")}
          </div>
          <div className="text-[10px] text-muted-foreground/70">
            {t("builder.sliderEditor.autoHint")}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {SLIDER_VARIANTS.map((v) => {
            const isActive = variant === v.value;
            const sample: SliderItem[] =
              items.length && items[0].image ? items.slice(0, 3) : demoItems.slice(0, 3);
            return (
              <div
                key={v.value}
                role="button"
                tabIndex={0}
                onClick={() => setContent("variant", v.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setContent("variant", v.value);
                  }
                }}
                title={bl(v.label)}
                className={`group relative text-left rounded-lg overflow-hidden transition-all duration-200 bg-card w-full cursor-pointer
                  ${
                    isActive
                      ? "ring-2 ring-brand ring-offset-1 ring-offset-background shadow-md"
                      : "ring-1 ring-border hover:ring-brand/60 hover:shadow-md"
                  }`}
              >
                {/* Uniform preview frame - pointer-events disabled so inner buttons don't conflict */}
                <div className="relative w-full aspect-[16/9] overflow-hidden bg-muted pointer-events-none">
                  <div className="absolute inset-0 [&>*]:!h-full [&>*]:!w-full">
                    <SliderRender
                      config={{
                        variant: v.value,
                        ratio: "16/9",
                        autoplay: true,
                        intervalMs: 2400,
                        rounded: "none",
                        overlayOpacity,
                        items: sample,
                      }}
                      lang={lang}
                    />
                  </div>
                  {isActive && (
                    <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white shadow z-10">
                      ✓
                    </div>
                  )}
                </div>
                {/* Label bar */}
                <div className="px-3 py-2 border-t border-border bg-background flex items-center justify-between gap-1">
                  <span
                    className={`text-xs font-medium truncate ${isActive ? "text-brand" : "text-foreground/80"}`}
                  >
                    {bl(v.label)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Columns (only for multi-card carousel) */}
      {variant === "multi-card" && (
        <div className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("builder.sliderEditor.carouselLayout")}
          </div>
          <PropField label={t("builder.sliderEditor.columnsDesktop")}>
            <Select value={String(columns)} onValueChange={(v) => setContent("columns", Number(v))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t("builder.sliderEditor.col1")}</SelectItem>
                <SelectItem value="2">{t("builder.sliderEditor.col2")}</SelectItem>
                <SelectItem value="3">{t("builder.sliderEditor.col3")}</SelectItem>
                <SelectItem value="4">{t("builder.sliderEditor.col4")}</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <div className="text-[10px] text-muted-foreground/80 leading-snug">
            {t("builder.sliderEditor.responsiveHint")}
          </div>
        </div>
      )}

      {/* Source */}
      <div className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.sliderEditor.sourceTitle")}
        </div>
        <PropField label={t("builder.sliderEditor.source")}>
          <Select value={source} onValueChange={(v) => setContent("source", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{t("builder.sliderEditor.sourceManual")}</SelectItem>
              <SelectItem value="posts">{t("builder.sliderEditor.sourcePosts")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        {source === "posts" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <PropField label={t("builder.sliderEditor.slidesCount")}>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={limit}
                  onChange={(e) =>
                    setContent("limit", Math.max(1, Math.min(20, Number(e.target.value) || 5)))
                  }
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={t("builder.sliderEditor.sorting")}>
                <Select value={orderBy} onValueChange={(v) => setContent("orderBy", v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">{t("builder.sliderEditor.newest")}</SelectItem>
                    <SelectItem value="oldest">{t("builder.sliderEditor.oldest")}</SelectItem>
                    <SelectItem value="title">{t("builder.sliderEditor.titleAZ")}</SelectItem>
                  </SelectContent>
                </Select>
              </PropField>
            </div>
            <PropField label={t("builder.sliderEditor.categories")}>
              <TaxonomyPicker
                mode="categories"
                value={categorySlugs}
                onChange={(v) => setContent("categorySlugs", v)}
              />
            </PropField>
            <PropField label={t("builder.sliderEditor.tags")}>
              <TaxonomyPicker
                mode="tags"
                value={tagSlugs}
                onChange={(v) => setContent("tagSlugs", v)}
              />
            </PropField>
            <PropField label={t("builder.sliderEditor.excludeIds")}>
              <Input
                value={excludeIds}
                onChange={(e) => setContent("excludeIds", e.target.value)}
                className="h-8 text-xs font-mono"
                placeholder="uuid1, uuid2"
              />
            </PropField>
            <PropField label={t("builder.sliderEditor.ctaText", { lang: lang.toUpperCase() })}>
              <Input
                value={ctaValue}
                onChange={(e) => setContent(ctaKey, e.target.value)}
                className="h-8 text-xs"
                placeholder={t("builder.sliderEditor.readMore")}
              />
            </PropField>
          </>
        )}
      </div>

      {/* Display toggles - hoisted for visibility */}
      <div className="space-y-2 rounded-md border-2 border-brand/40 p-2 bg-brand/5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-brand">
          {t("builder.sliderEditor.displayTitle")}
        </div>
        <label className="flex items-center justify-between gap-2 py-1 cursor-pointer">
          <span className="text-xs">{t("builder.sliderEditor.showCover")}</span>
          <Switch checked={showCover} onCheckedChange={(v) => setContent("showCover", v)} />
        </label>
        <label className="flex items-center justify-between gap-2 py-1 cursor-pointer border-t border-brand/20 pt-2">
          <span className="text-xs">{t("builder.sliderEditor.showTitle")}</span>
          <Switch checked={showTitle} onCheckedChange={(v) => setContent("showTitle", v)} />
        </label>
        <label className="flex items-center justify-between gap-2 py-1 cursor-pointer border-t border-brand/20 pt-2">
          <span className="text-xs">{t("builder.sliderEditor.showExcerpt")}</span>
          <Switch checked={showExcerpt} onCheckedChange={(v) => setContent("showExcerpt", v)} />
        </label>
        {/* Autor: WSPÓLNA kontrolka buildera - dwie niezależne osie widoczności
            plus oba rozmiary (12 px / 20 px domyślnie). */}
        <div className="border-t border-brand/20 pt-2 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("builder.sliderEditor.authorDisplay")}
          </p>
          <AuthorDisplayControl c={c} lang={lang} setContent={setContent} />
        </div>
      </div>

      {/* Settings */}

      <div className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.sliderEditor.settingsTitle")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.sliderEditor.ratio")}>
            <Select value={ratio} onValueChange={(v) => setContent("ratio", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="16/9">16:9</SelectItem>
                <SelectItem value="21/9">{t("builder.sliderEditor.ratio219")}</SelectItem>
                <SelectItem value="4/3">4:3</SelectItem>
                <SelectItem value="3/2">3:2</SelectItem>
                <SelectItem value="1/1">{t("builder.sliderEditor.ratio11")}</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label={t("builder.sliderEditor.rounded")}>
            <Select value={rounded} onValueChange={(v) => setContent("rounded", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("builder.sliderEditor.roundedNone")}</SelectItem>
                <SelectItem value="sm">{t("builder.sliderEditor.roundedSm")}</SelectItem>
                <SelectItem value="md">{t("builder.sliderEditor.roundedMd")}</SelectItem>
                <SelectItem value="lg">{t("builder.sliderEditor.roundedLg")}</SelectItem>
                <SelectItem value="xl">XL</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label={t("builder.sliderEditor.autoplay")}>
            <Select
              value={autoplay ? "on" : "off"}
              onValueChange={(v) => setContent("autoplay", v === "on")}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">{t("builder.sliderEditor.on")}</SelectItem>
                <SelectItem value="off">{t("builder.sliderEditor.off")}</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label={t("builder.sliderEditor.interval")}>
            <Input
              type="number"
              min={1500}
              max={20000}
              step={250}
              value={intervalMs}
              onChange={(e) => setContent("intervalMs", Number(e.target.value) || 4500)}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label={t("builder.sliderEditor.overlay")}>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={overlayOpacity}
              onChange={(e) =>
                setContent("overlayOpacity", Math.min(1, Math.max(0, Number(e.target.value) || 0)))
              }
              className="h-8 text-xs"
            />
          </PropField>
        </div>
      </div>

      {/* Nav buttons styling */}
      <div className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.sliderEditor.navTitle")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.sliderEditor.navSize", { px: navSizePx })}>
            <Input
              type="range"
              min={28}
              max={96}
              step={2}
              value={navSizePx}
              onChange={(e) =>
                setContent("navSizePx", Math.max(28, Math.min(96, Number(e.target.value) || 52)))
              }
              className="h-8"
            />
          </PropField>
          <PropField
            label={t("builder.sliderEditor.navRounded", {
              val:
                navRoundedPx >= 999
                  ? t("builder.sliderEditor.navRoundedFull")
                  : `${navRoundedPx}px`,
            })}
          >
            <Input
              type="range"
              min={0}
              max={64}
              step={1}
              value={navRoundedPx >= 999 ? 64 : navRoundedPx}
              onChange={(e) => {
                const v = Number(e.target.value);
                setContent("navRoundedPx", v >= 64 ? 999 : Math.max(0, v));
              }}
              className="h-8"
            />
          </PropField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.sliderEditor.navBgColor")}>
            <AdminColorPicker
              value={navBgColor}
              onChange={(v) => setContent("navBgColor", v ?? "#ffffff")}
              allowTransparent={false}
              allowReset={false}
              placeholder="#ffffff"
            />
          </PropField>
          <PropField label={t("builder.sliderEditor.navArrowColor")}>
            <AdminColorPicker
              value={navArrowColor}
              onChange={(v) => setContent("navArrowColor", v ?? "#ffffff")}
              allowTransparent={false}
              allowReset={false}
              placeholder="#ffffff"
            />
          </PropField>
        </div>
        <PropField label={t("builder.sliderEditor.navBgStyle")}>
          <Select value={navBgStyle} onValueChange={(v) => setContent("navBgStyle", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="glass">{t("builder.sliderEditor.bgGlass")}</SelectItem>
              <SelectItem value="solid">{t("builder.sliderEditor.bgSolid")}</SelectItem>
              <SelectItem value="outline">{t("builder.sliderEditor.bgOutline")}</SelectItem>
              <SelectItem value="soft">{t("builder.sliderEditor.bgSoft")}</SelectItem>
              <SelectItem value="gradient">{t("builder.sliderEditor.bgGradient")}</SelectItem>
              <SelectItem value="shadow">{t("builder.sliderEditor.bgShadow")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.sliderEditor.position")}>
          <Select value={navPosition} onValueChange={(v) => setContent("navPosition", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mid">{t("builder.sliderEditor.posMid")}</SelectItem>
              <SelectItem value="mid-outside">{t("builder.sliderEditor.posMidOutside")}</SelectItem>
              <SelectItem value="bottom">{t("builder.sliderEditor.posBottom")}</SelectItem>
              <SelectItem value="top">{t("builder.sliderEditor.posTop")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.sliderEditor.arrowShape")}>
          <Select value={navArrowVariant} onValueChange={(v) => setContent("navArrowVariant", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NAV_ARROW_VARIANTS.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {bl(v.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        <PropField
          label={t("builder.sliderEditor.arrowStroke", { val: navArrowStroke.toFixed(2) })}
        >
          <Input
            type="range"
            min={0.5}
            max={4}
            step={0.25}
            value={navArrowStroke}
            onChange={(e) =>
              setContent(
                "navArrowStroke",
                Math.max(0.5, Math.min(4, Number(e.target.value) || 2.25)),
              )
            }
            className="h-8"
          />
        </PropField>
        <div className="text-[10px] text-muted-foreground/80 leading-snug">
          {t("builder.sliderEditor.navHint")}
        </div>
      </div>

      {/* Typography: edit in the "Style" tab → Typography (title / subtitle) */}

      {/* Live preview */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.sliderEditor.livePreview")}
        </div>
        <div
          className="rounded-md border border-border p-2 bg-muted/20"
          data-testid="slider-live-preview"
        >
          <SliderRender config={previewCfg} lang={lang} />
        </div>
      </div>

      {/* Slides (manual mode only) */}
      {source !== "posts" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.sliderEditor.slides", { count: items.length })}
            </div>
            <button
              type="button"
              onClick={addItem}
              className="h-7 px-2 rounded border border-border hover:bg-muted text-xs"
            >
              {t("builder.sliderEditor.addSlide")}
            </button>
          </div>

          {items.map((it, i) => {
            const titleKey = `title_${lang}` as const;
            const subKey = `subtitle_${lang}` as const;
            const itemCtaKey = `cta_${lang}` as const;
            return (
              <div key={i} className="rounded-md border border-border p-2 space-y-2 bg-background">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium">
                    {t("builder.sliderEditor.slideTitle", { n: i + 1 })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveItem(i, -1)}
                      disabled={i === 0}
                      className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-muted disabled:opacity-40 text-xs"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(i, 1)}
                      disabled={i === items.length - 1}
                      className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-muted disabled:opacity-40 text-xs"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-destructive/10 text-destructive text-xs"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <PropField label={t("builder.sliderEditor.bindPost")}>
                  <PostPicker
                    value={it.postId}
                    onChange={(id) => updateItem(i, { postId: id })}
                    lang={lang}
                  />
                </PropField>

                <ImageSlot
                  label={
                    it.postId
                      ? t("builder.sliderEditor.imageOverride")
                      : t("builder.sliderEditor.image")
                  }
                  icon={<ImageIcon className="w-3 h-3" />}
                  value={it.image || ""}
                  onChange={(v) => updateItem(i, { image: v })}
                />

                <PropField label={t("builder.sliderEditor.title", { lang: lang.toUpperCase() })}>
                  <Input
                    value={(it[titleKey] as string) || ""}
                    onChange={(e) => updateItem(i, { [titleKey]: e.target.value })}
                    className="h-8 text-xs"
                    placeholder={t("builder.sliderEditor.titlePh")}
                  />
                </PropField>
                <PropField label={t("builder.sliderEditor.subtitle", { lang: lang.toUpperCase() })}>
                  <Input
                    value={(it[subKey] as string) || ""}
                    onChange={(e) => updateItem(i, { [subKey]: e.target.value })}
                    className="h-8 text-xs"
                    placeholder={t("builder.sliderEditor.subtitlePh")}
                  />
                </PropField>
                <div className="grid grid-cols-2 gap-2">
                  <PropField label={t("builder.sliderEditor.link")}>
                    <Input
                      value={it.href || ""}
                      onChange={(e) => updateItem(i, { href: e.target.value })}
                      className="h-8 text-xs"
                      placeholder="/post/..."
                    />
                  </PropField>
                  <PropField label={t("builder.sliderEditor.cta", { lang: lang.toUpperCase() })}>
                    <Input
                      value={(it[itemCtaKey] as string) || ""}
                      onChange={(e) => updateItem(i, { [itemCtaKey]: e.target.value })}
                      className="h-8 text-xs"
                      placeholder={t("builder.sliderEditor.readMore")}
                    />
                  </PropField>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <PropField
                    label={t("builder.sliderEditor.category", { lang: lang.toUpperCase() })}
                  >
                    <Input
                      value={(it[`category_${lang}` as const] as string) || ""}
                      onChange={(e) => updateItem(i, { [`category_${lang}`]: e.target.value })}
                      className="h-8 text-xs"
                      placeholder={t("builder.sliderEditor.categoryPh")}
                    />
                  </PropField>
                  <PropField label={t("builder.common.color")}>
                    <AdminColorPicker
                      value={it.categoryColor || "#ef6c2e"}
                      onChange={(v) => updateItem(i, { categoryColor: v ?? "#ef6c2e" })}
                      allowTransparent={false}
                      allowReset={false}
                    />
                  </PropField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <PropField label={t("builder.sliderEditor.author")}>
                    <Input
                      value={it.author || ""}
                      onChange={(e) => updateItem(i, { author: e.target.value })}
                      className="h-8 text-xs"
                      placeholder={t("builder.sliderEditor.authorPh")}
                    />
                  </PropField>
                  <PropField label={t("builder.sliderEditor.readTime")}>
                    <Input
                      value={it.readTime || ""}
                      onChange={(e) => updateItem(i, { readTime: e.target.value })}
                      className="h-8 text-xs"
                      placeholder={t("builder.sliderEditor.readTimePh")}
                    />
                  </PropField>
                </div>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded">
              {t("builder.sliderEditor.noSlides")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
