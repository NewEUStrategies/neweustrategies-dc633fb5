// Organism: post list / carousel query + display editor (Elementor-style).
// Owns query settings (categories, tags, exclusions, author, formats, order,
// limit, offset) plus display options (variant, columns). Persists everything
// on the widget content so PostListView can render the matching posts.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PropField, CollapsibleSection as Collapsible, ColorField } from "../../atoms";
import { AdminDatePicker } from "@/components/admin/blocks/AdminDatePicker";
import { IndexColorPreview } from "./IndexColorPreview";
import { DisplayLivePreview } from "./DisplayLivePreview";
import { AuthorDisplayControl } from "../../molecules/AuthorDisplayControl";
import { TaxonomyPicker } from "./TaxonomyPicker";
import { ImageSlot } from "./ImageSlot";
import { readThumbnailOverrides, setThumbnailOverride } from "@/lib/builder/thumbnailOverrides";
import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { asBool, asNum, asOneOf, asStr } from "@/lib/content-model/contentValue";
import {
  POST_LIST_ORDER_BY,
  postListOrderColumn,
  postListVariantHasByline,
} from "@/lib/builder/postListQuery";
import {
  CAROUSEL_AUTOPLAY_DEFAULT_MS,
  CAROUSEL_AUTOPLAY_MAX_MS,
  CAROUSEL_AUTOPLAY_MIN_MS,
  carouselAutoplayEnabled,
  carouselAutoplayIntervalMs,
} from "@/lib/builder/postListCarousel";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
  /** Typ widgetu obslugiwanego przez ten edytor. Panel uzywa go dla obu
   *  wariantow ("post-list" i "carousel"), a ustawienia karuzeli maja sens
   *  wylacznie dla tego drugiego - inaczej byloby to kolejne martwe pole. */
  widgetType?: "post-list" | "carousel";
}

const VARIANTS = [
  "card",
  "boxed-grid",
  "minimal",
  "classic",
  "flex-grid",
  "overlay",
  "list",
  "boxed-list",
  "numbered",
  "ranked",
] as const;
const VARIANT_KEY: Record<(typeof VARIANTS)[number], string> = {
  card: "varCard",
  "boxed-grid": "varBoxedGrid",
  minimal: "varMinimal",
  classic: "varClassic",
  "flex-grid": "varFlexGrid",
  overlay: "varOverlay",
  list: "varList",
  "boxed-list": "varBoxedList",
  numbered: "varNumbered",
  ranked: "varRanked",
};

// Lista sortowan pochodzi z warstwy zapytania - edytor NIE moze oferowac
// sortowania, ktorego zapytanie nie realizuje (tak powstal martwy "created_at").
const ORDER_BY = POST_LIST_ORDER_BY;
const ORDER_KEY: Record<(typeof ORDER_BY)[number], string> = {
  published_at: "obPublished",
  created_at: "obCreated",
  title: "obTitle",
  popular: "obPopular",
  random: "obRandom",
};

const POST_FORMATS = ["", "standard", "video", "audio", "gallery", "quote"] as const;
const FORMAT_KEY: Record<string, string> = {
  "": "fmtAll",
  standard: "fmtStandard",
  video: "fmtVideo",
  audio: "fmtAudio",
  gallery: "fmtGallery",
  quote: "fmtQuote",
};

// Odczyt tresci przechodzi przez kanoniczna koercje (`contentValue`), zeby
// edytor widzial DOKLADNIE te same wartosci co renderer.
function str(c: WidgetNode["content"], k: string, dflt = ""): string {
  const v = asStr(c[k]);
  return v === "" ? dflt : v;
}
function num(c: WidgetNode["content"], k: string, dflt: number): number {
  return asNum(c[k], dflt);
}

/** Zestaw filtrow zapytania wspolny dla licznika i podgladu miniatur. */
interface PostFilterInput {
  postFormat: string;
  authorId: string;
  dateFrom: string;
  dateTo: string;
  includeCats: string[];
  excludeCats: string[];
  includeTags: string[];
  excludeTags: string[];
  includeIds: string[];
  excludeIds: string[];
}

const splitCsv = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function readFilters(c: WidgetNode["content"]): PostFilterInput {
  return {
    postFormat: str(c, "postFormat"),
    authorId: str(c, "authorId"),
    dateFrom: str(c, "dateFrom"),
    dateTo: str(c, "dateTo"),
    includeCats: splitCsv(str(c, "categoriesCsv")),
    excludeCats: splitCsv(str(c, "excludeCategoriesCsv")),
    includeTags: splitCsv(str(c, "tagsCsv")),
    excludeTags: splitCsv(str(c, "excludeTagsCsv")),
    includeIds: splitCsv(str(c, "includeIdsCsv")),
    excludeIds: splitCsv(str(c, "excludeIdsCsv")),
  };
}

/**
 * Rozwiazuje kategorie / tagi / konkretne ID do zbiorow post_id, dokladnie tak
 * jak `postListQuery.fetchPostListRows`. `impossible` oznacza przeciecie puste
 * (np. kategoria bez wpisow) - zapytanie nie ma sensu i zwraca zero wynikow.
 */
async function resolvePostFilterSets(f: PostFilterInput): Promise<{
  includeSet: Set<string> | null;
  excludeSet: Set<string>;
  impossible: boolean;
}> {
  const [incCatIds, incTagIds, excCatIds, excTagIds] = await Promise.all([
    resolveTaxonomyIds("post_categories", f.includeCats),
    resolveTaxonomyIds("post_tags", f.includeTags),
    resolveTaxonomyIds("post_categories", f.excludeCats),
    resolveTaxonomyIds("post_tags", f.excludeTags),
  ]);
  let includeSet: Set<string> | null = null;
  const intersect = (s: Set<string>) => {
    includeSet = includeSet ? new Set([...includeSet].filter((x) => s.has(x))) : new Set(s);
  };
  if (f.includeCats.length) intersect(incCatIds);
  if (f.includeTags.length) intersect(incTagIds);
  if (f.includeIds.length) intersect(new Set(f.includeIds));
  const excludeSet = new Set<string>([...excCatIds, ...excTagIds, ...f.excludeIds]);
  const resolved = includeSet as Set<string> | null;
  return { includeSet: resolved, excludeSet, impossible: resolved !== null && resolved.size === 0 };
}

/**
 * Ustawienia karuzeli - WYDZIELONE do własnego komponentu, nie tylko dla
 * porządku.
 *
 * Wcześniej `autoplay` / `autoplayIntervalMs` były czytane na górze
 * `PostListEditor`, czyli także dla widgetu `post-list`, który karuzelą nie jest
 * i tych kluczy nigdy nie renderuje. Odczyt bez kontrolki to dokładnie ten sam
 * rodzaj kłamstwa, co kontrolka bez odczytu - panel "wiedział" o ustawieniu,
 * którego nie oferował. Teraz oba klucze są czytane wyłącznie tam, gdzie
 * istnieje ich kontrolka i ich konsument.
 */
function CarouselSection({
  c,
  setContent,
}: {
  c: WidgetNode["content"];
  setContent: (k: string, v: Json) => void;
}) {
  const { t } = useTranslation();
  const autoplay = carouselAutoplayEnabled(c);
  const autoplayIntervalMs = carouselAutoplayIntervalMs(c);
  return (
    <Collapsible title={t("builder.postListEditor.carouselTitle")} defaultOpen>
      <div className="space-y-2">
        <PropField
          label={t("builder.postListEditor.autoplay")}
          hint={t("builder.postListEditor.autoplayHint")}
        >
          <div className="flex h-8 items-center">
            <Switch
              checked={autoplay}
              onCheckedChange={(next) => setContent("autoplay", next)}
              aria-label={t("builder.postListEditor.autoplay")}
            />
          </div>
        </PropField>
        {autoplay && (
          <PropField label={t("builder.postListEditor.autoplayInterval")}>
            <Input
              type="number"
              min={CAROUSEL_AUTOPLAY_MIN_MS}
              max={CAROUSEL_AUTOPLAY_MAX_MS}
              step={500}
              value={autoplayIntervalMs}
              onChange={(e) =>
                setContent(
                  "autoplayIntervalMs",
                  Math.min(
                    CAROUSEL_AUTOPLAY_MAX_MS,
                    Math.max(
                      CAROUSEL_AUTOPLAY_MIN_MS,
                      Number(e.target.value) || CAROUSEL_AUTOPLAY_DEFAULT_MS,
                    ),
                  ),
                )
              }
              className="h-8 text-xs"
            />
          </PropField>
        )}
      </div>
    </Collapsible>
  );
}

/**
 * Grubości czcionki oferowane dla tytułu i zajawki (spójne z rated-list).
 *
 * `INHERIT` jest wartownikiem kontrolki, nie wartością treści: Radix Select nie
 * przyjmuje pustego stringa jako wartości pozycji (puste znaczy "brak wyboru"),
 * a w treści widgetu "grubość domyślna" to właśnie pusty string.
 */
const WEIGHT_INHERIT = "inherit";
const WEIGHT_OPTIONS: ReadonlyArray<string> = ["300", "400", "500", "600", "700", "800"];

export function PostListEditor({ c, lang, setContent, widgetType = "post-list" }: Props) {
  const { t } = useTranslation();
  const variant = str(c, "variant", "card");
  const columns = num(c, "columns", 3);
  const limit = num(c, "limit", 6);
  const offset = num(c, "offset", 0);
  const orderBy = str(c, "orderBy", "published_at");
  const orderDir = str(c, "orderDir", "desc");
  const postFormat = str(c, "postFormat", "");
  const authorId = str(c, "authorId", "");
  const dateFrom = str(c, "dateFrom", "");
  const dateTo = str(c, "dateTo", "");
  const popularDays = num(c, "popularDays", 30);
  const uniqueOnPage = asBool(c["uniqueOnPage"], false);
  const mobileHScroll = asBool(c["mobileHorizontalScroll"], false);
  // Ustawienia autora pokazujemy WYLACZNIE dla wariantow, ktore rysuja byline
  // i dla ktorych zapytanie dociaga profil autora (jedna lista, wspoldzielona
  // z warstwa zapytania). Wczesniej pole wisialo w kazdym wariancie, a w
  // czesci z nich nie robilo nic.
  const supportsByline = postListVariantHasByline(variant);

  const categoriesCsv = str(c, "categoriesCsv", "");
  const excludeCategoriesCsv = str(c, "excludeCategoriesCsv", "");
  const tagsCsv = str(c, "tagsCsv", "");
  const excludeTagsCsv = str(c, "excludeTagsCsv", "");
  const includeIdsCsv = str(c, "includeIdsCsv", "");
  const excludeIdsCsv = str(c, "excludeIdsCsv", "");

  const { data: authors = [] } = useQuery({
    queryKey: ["post-list-authors"],
    staleTime: 60_000,
    queryFn: async () => {
      // No `email` here: the profiles column grant excludes it (PII); the
      // picker labels fall back to the public author slug.
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, slug")
        .order("display_name", { ascending: true });
      return (data ?? []) as { id: string; display_name: string | null; slug: string | null }[];
    },
  });

  const authorLabel = (a: { display_name: string | null; slug: string | null }) =>
    (a.display_name && a.display_name.trim()) || a.slug || "-";

  // Licznik "pasujacych wpisow". MUSI stosowac dokladnie te filtry, ktore ma w
  // kluczu zapytania - wczesniej kategorie, tagi i daty siedzialy w kluczu, ale
  // queryFn ich nie stosowal, wiec panel pokazywal liczbe WSZYSTKICH wpisow i
  // po prostu klamal (np. "142" przy kategorii z 3 wpisami).
  const countKey = useMemo(
    () =>
      [
        "post-list-count",
        categoriesCsv,
        excludeCategoriesCsv,
        tagsCsv,
        excludeTagsCsv,
        includeIdsCsv,
        excludeIdsCsv,
        postFormat,
        authorId,
        dateFrom,
        dateTo,
      ].join("|"),
    [
      categoriesCsv,
      excludeCategoriesCsv,
      tagsCsv,
      excludeTagsCsv,
      includeIdsCsv,
      excludeIdsCsv,
      postFormat,
      authorId,
      dateFrom,
      dateTo,
    ],
  );
  const { data: matchCount } = useQuery({
    queryKey: ["post-list-editor-count", countKey],
    staleTime: 30_000,
    queryFn: async () => {
      const filters = readFilters(c);
      const { includeSet, excludeSet, impossible } = await resolvePostFilterSets(filters);
      if (impossible) return 0;
      let q = supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "published")
        .is("deleted_at", null);
      if (filters.postFormat) q = q.eq("post_format", filters.postFormat);
      if (filters.authorId) q = q.eq("author_id", filters.authorId);
      if (filters.dateFrom) q = q.gte("published_at", `${filters.dateFrom}T00:00:00Z`);
      if (filters.dateTo) q = q.lte("published_at", `${filters.dateTo}T23:59:59Z`);
      if (includeSet) q = q.in("id", Array.from(includeSet));
      if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);
      const { count } = await q;
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-2">
      {/* ── Display ─────────────────────────────────────────── */}
      <Collapsible title={t("builder.postListEditor.display")} defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.postListEditor.variant")}>
            <Select value={variant} onValueChange={(v) => setContent("variant", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VARIANTS.map((o) => (
                  <SelectItem key={o} value={o} className="text-xs">
                    {t(`builder.postListEditor.${VARIANT_KEY[o]}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropField>
          {variant !== "numbered" && variant !== "list" && variant !== "ranked" && (
            <PropField label={t("builder.postListEditor.columns")}>
              <Input
                type="number"
                min={1}
                max={6}
                value={columns}
                onChange={(e) => setContent("columns", Number(e.target.value) || 1)}
                className="h-8 text-xs"
              />
            </PropField>
          )}
          {variant !== "ranked" && (
            <PropField label={t("builder.postListEditor.imageAspect")}>
              <Select
                value={str(c, "imageAspect", "4/3")}
                onValueChange={(v) => setContent("imageAspect", v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4/3" className="text-xs">
                    {t("builder.postListEditor.aspH43")}
                  </SelectItem>
                  <SelectItem value="3/4" className="text-xs">
                    {t("builder.postListEditor.aspV34")}
                  </SelectItem>
                  <SelectItem value="1/1" className="text-xs">
                    {t("builder.postListEditor.aspSq11")}
                  </SelectItem>
                  <SelectItem value="16/9" className="text-xs">
                    {t("builder.postListEditor.aspW169")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </PropField>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <PropField label={t("builder.postListEditor.showCover")}>
            <Select
              value={str(c, "showCover", "1") === "0" ? "0" : "1"}
              onValueChange={(v) => setContent("showCover", v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1" className="text-xs">
                  {t("builder.postListEditor.yes")}
                </SelectItem>
                <SelectItem value="0" className="text-xs">
                  {t("builder.postListEditor.no")}
                </SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label={t("builder.postListEditor.showTitle")}>
            <Select
              value={str(c, "showTitle", "1") === "0" ? "0" : "1"}
              onValueChange={(v) => setContent("showTitle", v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1" className="text-xs">
                  {t("builder.postListEditor.yes")}
                </SelectItem>
                <SelectItem value="0" className="text-xs">
                  {t("builder.postListEditor.no")}
                </SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label={t("builder.postListEditor.showExcerpt")}>
            <Select
              value={str(c, "showExcerpt", "1") === "0" ? "0" : "1"}
              onValueChange={(v) => setContent("showExcerpt", v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1" className="text-xs">
                  {t("builder.postListEditor.yes")}
                </SelectItem>
                <SelectItem value="0" className="text-xs">
                  {t("builder.postListEditor.no")}
                </SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          {/* Grubości: renderer honorował `titleWeight` / `excerptWeight` (mają
              pierwszeństwo nad typografią współdzieloną), ale panel nie dawał na
              nie kontrolki - jedyną drogą było ręczne grzebanie w treści. */}
          {(
            [
              ["titleWeight", "builder.postListEditor.titleWeight", "Grubość tytułu"],
              ["excerptWeight", "builder.postListEditor.excerptWeight", "Grubość opisu"],
            ] as const
          ).map(([key, i18nKey, fallback]) => (
            <PropField key={key} label={t(i18nKey, { defaultValue: fallback })}>
              <Select
                value={str(c, key, "") || WEIGHT_INHERIT}
                onValueChange={(v) => setContent(key, v === WEIGHT_INHERIT ? "" : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WEIGHT_INHERIT} className="text-xs">
                    {t("builder.postListEditor.weightInherit")}
                  </SelectItem>
                  {WEIGHT_OPTIONS.map((weight) => (
                    <SelectItem key={weight} value={weight} className="text-xs">
                      {weight}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
          ))}
        </div>
        {/* Autor: WSPÓLNA kontrolka (te same klucze i ten sam rezolwer, co
            slider, lista z oceną i metadane wpisu). Wcześniej post-lista miała
            własny trójstanowy select, który nie potrafił wyrazić „samo zdjęcie"
            ani zmienić rozmiaru bylinu. */}
        {supportsByline && (
          <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("builder.postListEditor.authorDisplay")}
            </p>
            <p className="text-[9px] leading-snug text-muted-foreground/60">
              {t("builder.postListEditor.authorDisplayHint")}
            </p>
            <AuthorDisplayControl c={c} lang={lang} setContent={setContent} />
          </div>
        )}
        <DisplayLivePreview c={c} lang={lang} />
      </Collapsible>
      {/* anchor */}

      {/* ── Carousel ───────────────────────────────────────── */}
      {widgetType === "carousel" && <CarouselSection c={c} setContent={setContent} />}

      {/* ── Query ──────────────────────────────────────────── */}
      <Collapsible title={t("builder.postListEditor.queryFilters")} defaultOpen>
        <div className="space-y-2">
          <PropField label={t("builder.postListEditor.catsInclude")}>
            <TaxonomyPicker
              mode="categories"
              value={categoriesCsv}
              onChange={(v) => setContent("categoriesCsv", v)}
            />
          </PropField>
          <PropField label={t("builder.postListEditor.catsExclude")}>
            <TaxonomyPicker
              mode="categories"
              value={excludeCategoriesCsv}
              onChange={(v) => setContent("excludeCategoriesCsv", v)}
              placeholder={t("builder.postListEditor.none")}
            />
          </PropField>
          <PropField label={t("builder.postListEditor.tagsInclude")}>
            <TaxonomyPicker
              mode="tags"
              value={tagsCsv}
              onChange={(v) => setContent("tagsCsv", v)}
            />
          </PropField>
          <PropField label={t("builder.postListEditor.tagsExclude")}>
            <TaxonomyPicker
              mode="tags"
              value={excludeTagsCsv}
              onChange={(v) => setContent("excludeTagsCsv", v)}
              placeholder={t("builder.postListEditor.none")}
            />
          </PropField>

          <div className="grid grid-cols-2 gap-2">
            <PropField label={t("builder.postListEditor.postFormat")}>
              <Select
                value={postFormat || "__all__"}
                onValueChange={(v) => setContent("postFormat", v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POST_FORMATS.map((o) => (
                    <SelectItem key={o || "__all__"} value={o || "__all__"} className="text-xs">
                      {t(`builder.postListEditor.${FORMAT_KEY[o]}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
            <PropField label={t("builder.postListEditor.author")}>
              <Select
                value={authorId || "__all__"}
                onValueChange={(v) => setContent("authorId", v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("builder.postListEditor.allAuthors")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">
                    {t("builder.postListEditor.allAuthors")}
                  </SelectItem>
                  {authors.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {authorLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
          </div>

          <PropField
            label={t("builder.postListEditor.includeIds")}
            hint={t("builder.postListEditor.includeIdsHint")}
          >
            <Input
              value={includeIdsCsv}
              placeholder="uuid1, uuid2"
              onChange={(e) => setContent("includeIdsCsv", e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </PropField>
          <PropField label={t("builder.postListEditor.excludeIds")}>
            <Input
              value={excludeIdsCsv}
              placeholder="uuid1, uuid2"
              onChange={(e) => setContent("excludeIdsCsv", e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </PropField>

          <div className="grid grid-cols-2 gap-2">
            <PropField label={t("builder.postListEditor.dateFrom")}>
              <AdminDatePicker value={dateFrom} onChange={(v) => setContent("dateFrom", v ?? "")} />
            </PropField>
            <PropField label={t("builder.postListEditor.dateTo")}>
              <AdminDatePicker value={dateTo} onChange={(v) => setContent("dateTo", v ?? "")} />
            </PropField>
          </div>
        </div>
      </Collapsible>

      {/* ── Behaviour ──────────────────────────────────────── */}
      <Collapsible title={t("builder.postListEditor.behaviour")} defaultOpen={false}>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={uniqueOnPage}
              onChange={(e) => setContent("uniqueOnPage", e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span>{t("builder.postListEditor.uniqueOnPage")}</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={mobileHScroll}
              onChange={(e) => setContent("mobileHorizontalScroll", e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span>{t("builder.postListEditor.mobileScroll")}</span>
          </label>
          <div className="text-[10px] text-muted-foreground">
            {t("builder.postListEditor.behaviourHint")}
          </div>
        </div>
      </Collapsible>

      {/* ── Sort / paging ──────────────────────────────────── */}
      <Collapsible title={t("builder.postListEditor.sortPaging")} defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.postListEditor.sortBy")}>
            <Select value={orderBy} onValueChange={(v) => setContent("orderBy", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_BY.map((o) => (
                  <SelectItem key={o} value={o} className="text-xs">
                    {t(`builder.postListEditor.${ORDER_KEY[o]}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropField>
          <PropField label={t("builder.postListEditor.direction")}>
            <Select value={orderDir} onValueChange={(v) => setContent("orderDir", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc" className="text-xs">
                  {t("builder.postListEditor.descending")}
                </SelectItem>
                <SelectItem value="asc" className="text-xs">
                  {t("builder.postListEditor.ascending")}
                </SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label={t("builder.postListEditor.limit")}>
            <Input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) => setContent("limit", Math.max(1, Number(e.target.value) || 1))}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label={t("builder.postListEditor.offset")}>
            <Input
              type="number"
              min={0}
              max={1000}
              value={offset}
              onChange={(e) => setContent("offset", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 text-xs"
            />
          </PropField>
          {orderBy === "popular" && (
            <PropField label={t("builder.postListEditor.popularDays")}>
              <Input
                type="number"
                min={1}
                max={365}
                value={popularDays}
                onChange={(e) =>
                  setContent("popularDays", Math.max(1, Number(e.target.value) || 30))
                }
                className="h-8 text-xs"
              />
            </PropField>
          )}
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground">
          {typeof matchCount === "number"
            ? t("builder.postListEditor.matchCount", {
                count: matchCount,
                lang: lang.toUpperCase(),
              })
            : t("builder.postListEditor.counting")}
        </div>
      </Collapsible>

      <PerPostThumbnailsSection c={c} lang={lang} setContent={setContent} />

      {/* Title / excerpt typography: managed only in the "Style" → Typography tab
          (single source of truth, works via `.cms-post-title` / `.cms-post-excerpt`).
          No duplicates here. */}

      {(variant === "numbered" || variant === "ranked") && (
        <Collapsible title={t("builder.postListEditor.numberingTitle")} defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <PropField label={t("builder.postListEditor.sizePx")}>
              <Input
                type="number"
                min={12}
                max={240}
                value={num(c, "indexSizePx", 52)}
                onChange={(e) => setContent("indexSizePx", Number(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label={t("builder.postListEditor.weight")}>
              <Select
                value={str(c, "indexWeight", "800")}
                onValueChange={(v) => setContent("indexWeight", v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["300", "400", "500", "600", "700", "800", "900"].map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
            <PropField label={t("builder.postListEditor.hPosition")}>
              <Select
                value={str(c, "indexSide", "right")}
                onValueChange={(v) => setContent("indexSide", v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">{t("builder.postListEditor.left")}</SelectItem>
                  <SelectItem value="right">{t("builder.postListEditor.right")}</SelectItem>
                </SelectContent>
              </Select>
            </PropField>
            <PropField label={t("builder.postListEditor.vPosition")}>
              <Select
                value={str(c, "indexVAlign", "top")}
                onValueChange={(v) => setContent("indexVAlign", v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">{t("builder.postListEditor.vTop")}</SelectItem>
                  <SelectItem value="middle">{t("builder.postListEditor.vMiddle")}</SelectItem>
                  <SelectItem value="bottom">{t("builder.postListEditor.vBottom")}</SelectItem>
                </SelectContent>
              </Select>
            </PropField>
          </div>

          <div className="grid grid-cols-1 gap-3 mt-3 p-2.5 rounded-md border border-border/60 bg-muted/30">
            <PropField label={t("builder.postListEditor.colorLight")}>
              <ColorField
                value={str(c, "indexColor", "")}
                onChange={(v) => setContent("indexColor", v ?? "")}
              />
            </PropField>
            <PropField label={t("builder.postListEditor.colorDark")}>
              <ColorField
                value={str(c, "indexColorDark", "")}
                onChange={(v) => setContent("indexColorDark", v ?? "")}
              />
            </PropField>
          </div>
          <PropField
            label={t("builder.postListEditor.opacity", {
              pct: Math.round(
                (num(c, "indexOpacity", -1) < 0 ? 0.05 : num(c, "indexOpacity", 0.05)) * 100,
              ),
            })}
          >
            <Input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={num(c, "indexOpacity", -1) < 0 ? 0.05 : num(c, "indexOpacity", 0.05)}
              onChange={(e) => setContent("indexOpacity", Number(e.target.value))}
              className="h-6"
            />
          </PropField>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {t("builder.postListEditor.opacityHint")}
          </div>
          <IndexColorPreview
            indexColor={str(c, "indexColor", "")}
            indexColorDark={str(c, "indexColorDark", "")}
            indexOpacity={num(c, "indexOpacity", -1)}
            indexSizePx={num(c, "indexSizePx", 52)}
            indexWeight={str(c, "indexWeight", "800")}
          />
        </Collapsible>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-post thumbnail overrides
// ──────────────────────────────────────────────────────────────────────────────

interface PreviewRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  cover_image_url: string | null;
  author_id: string | null;
}

async function resolveTaxonomyIds(
  table: "post_categories" | "post_tags",
  slugs: string[],
): Promise<Set<string>> {
  if (!slugs.length) return new Set();
  if (table === "post_categories") {
    const { data: cats } = await supabase.from("categories").select("id").in("slug", slugs);
    const ids = (cats ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return new Set();
    const { data: links } = await supabase
      .from("post_categories")
      .select("post_id")
      .in("category_id", ids);
    return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
  }
  const { data: tags } = await supabase.from("tags").select("id").in("slug", slugs);
  const ids = (tags ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) return new Set();
  const { data: links } = await supabase.from("post_tags").select("post_id").in("tag_id", ids);
  return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
}

function PerPostThumbnailsSection({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const limit = Math.max(1, Math.min(100, num(c, "limit", 6)));
  const offset = Math.max(0, num(c, "offset", 0));
  // Sortowanie zawezone do wartosci, ktore zapytanie widgetu realizuje.
  const safeOrderBy = asOneOf(c["orderBy"], POST_LIST_ORDER_BY, "published_at");
  const orderDir: "asc" | "desc" = str(c, "orderDir", "desc") === "asc" ? "asc" : "desc";
  const postFormat = str(c, "postFormat");
  const authorId = str(c, "authorId");
  const dateFrom = str(c, "dateFrom");
  const dateTo = str(c, "dateTo");
  const categoriesCsv = str(c, "categoriesCsv");
  const excludeCategoriesCsv = str(c, "excludeCategoriesCsv");
  const tagsCsv = str(c, "tagsCsv");
  const excludeTagsCsv = str(c, "excludeTagsCsv");
  const includeIdsCsv = str(c, "includeIdsCsv");
  const excludeIdsCsv = str(c, "excludeIdsCsv");

  const overrides = readThumbnailOverrides(c);

  // Klucz z samych prymitywow (surowe CSV zamiast swiezych tablic), wiec nie
  // zmienia tozsamosci przy kazdym renderze panelu.
  const queryKey = useMemo(
    () => [
      "post-list-editor-preview",
      {
        limit,
        offset,
        orderBy: safeOrderBy,
        orderDir,
        postFormat,
        authorId,
        dateFrom,
        dateTo,
        categoriesCsv,
        excludeCategoriesCsv,
        tagsCsv,
        excludeTagsCsv,
        includeIdsCsv,
        excludeIdsCsv,
        lang,
      },
    ],
    [
      limit,
      offset,
      safeOrderBy,
      orderDir,
      postFormat,
      authorId,
      dateFrom,
      dateTo,
      categoriesCsv,
      excludeCategoriesCsv,
      tagsCsv,
      excludeTagsCsv,
      includeIdsCsv,
      excludeIdsCsv,
      lang,
    ],
  );

  const { data: rows = [], isLoading } = useQuery<PreviewRow[]>({
    queryKey,
    staleTime: 30_000,
    queryFn: async () => {
      const filters = readFilters(c);
      const { includeSet, excludeSet, impossible } = await resolvePostFilterSets(filters);
      if (impossible) return [];

      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, cover_image_url, author_id")
        .eq("status", "published")
        .is("deleted_at", null);
      if (filters.postFormat) q = q.eq("post_format", filters.postFormat);
      if (filters.authorId) q = q.eq("author_id", filters.authorId);
      if (filters.dateFrom) q = q.gte("published_at", `${filters.dateFrom}T00:00:00Z`);
      if (filters.dateTo) q = q.lte("published_at", `${filters.dateTo}T23:59:59Z`);
      if (includeSet) q = q.in("id", Array.from(includeSet));
      if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);

      // Kolumna sortowania pochodzi z warstwy zapytania widgetu - podglad i
      // realny widget MUSZA sortowac tak samo. Wczesniej podglad mial wlasna
      // kopie mapowania i sortowal po "created_at", ktorego widget nie
      // obslugiwal (cicho degradowal do "published_at").
      q = q.order(postListOrderColumn(safeOrderBy, lang), { ascending: orderDir === "asc" });
      q = q.range(offset, offset + limit - 1);
      const { data } = await q;
      return (data ?? []) as PreviewRow[];
    },
  });

  const updateOverride = (postId: string, url: string) => {
    const next = setThumbnailOverride(overrides, postId, url);
    setContent("thumbnailOverrides", next as unknown as import("@/lib/builder/types").Json);
  };

  const titleOf = (p: PreviewRow) =>
    (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en || p.slug;

  const variant = str(c, "variant", "card");
  const isRanked = variant === "ranked";
  const byLabel = lang === "pl" ? "Autor" : "By";

  const authorIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x))),
    [rows],
  );
  const { data: authorMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["post-list-editor-authors", authorIds],
    enabled: isRanked && authorIds.length > 0,
    queryFn: async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", authorIds);
      const m: Record<string, string> = {};
      for (const r of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
        if (r.display_name) m[r.id] = r.display_name;
      }
      return m;
    },
  });

  return (
    <Collapsible
      title={
        isRanked
          ? t("builder.postListEditor.rankPreview")
          : t("builder.postListEditor.thumbOverrides")
      }
      defaultOpen={false}
    >
      <div className="space-y-3">
        <div className="text-[10px] text-muted-foreground">
          {isRanked ? t("builder.postListEditor.rankHint") : t("builder.postListEditor.thumbHint")}
        </div>
        {isLoading && (
          <div className="text-xs text-muted-foreground">{t("builder.postListEditor.loading")}</div>
        )}
        {!isLoading && rows.length === 0 && (
          <div className="text-xs text-muted-foreground">{t("builder.postListEditor.noPosts")}</div>
        )}

        {isRanked &&
          rows.map((p, i) => {
            const authorName = p.author_id ? (authorMap[p.author_id] ?? "") : "";
            const side = str(c, "indexSide", "right") === "left" ? "left" : "right";
            const vAlignRaw = str(c, "indexVAlign", "top");
            const vAlign = vAlignRaw === "middle" || vAlignRaw === "bottom" ? vAlignRaw : "top";
            const sizePx = (() => {
              const raw = c["indexSizePx"];
              const n = typeof raw === "number" ? raw : Number(raw);
              return Number.isFinite(n) && n > 0 ? n : 96;
            })();
            // Cap preview size so it fits the narrow sidebar without clipping.
            const previewSize = Math.min(sizePx, 64);
            const vStyle: React.CSSProperties =
              vAlign === "top"
                ? { top: "0.5rem", bottom: "auto" }
                : vAlign === "bottom"
                  ? { top: "auto", bottom: "0.5rem" }
                  : { top: "50%", transform: "translateY(-50%)" };
            return (
              <div
                key={p.id}
                className="relative isolate overflow-hidden rounded-md border border-border bg-card px-3 py-3"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute font-display tabular-nums leading-none select-none"
                  style={
                    {
                      left: side === "left" ? "0.5rem" : "auto",
                      right: side === "right" ? "0.5rem" : "auto",
                      ...vStyle,
                      textAlign: side,
                      fontSize: `${previewSize}px`,
                      fontWeight: 800,
                      color: "rgb(250,147,70)",
                      opacity: 0.18,
                      zIndex: 0,
                    } as React.CSSProperties
                  }
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="relative z-10 w-full">
                  <div className="text-xs font-semibold leading-snug line-clamp-2">
                    {titleOf(p)}
                  </div>
                  {authorName && (
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      <span className="opacity-70">{byLabel}</span>{" "}
                      <span className="font-medium text-foreground">{authorName}</span>
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground/70 truncate font-mono">
                    {p.slug}
                  </div>
                </div>
              </div>
            );
          })}

        {!isRanked &&
          rows.map((p) => {
            const current = overrides[p.id] || "";
            const preview = current || p.cover_image_url || "";
            return (
              <div key={p.id} className="rounded-md border border-border p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative w-14 aspect-[4/3] shrink-0 overflow-hidden rounded-sm bg-muted">
                    {preview && (
                      <img
                        src={preview}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{titleOf(p)}</div>
                    <div className="text-[10px] text-muted-foreground truncate font-mono">
                      {p.slug}
                    </div>
                  </div>
                </div>
                <ImageSlot
                  label={t("builder.postListEditor.thumbLabel")}
                  icon={<ImageIcon className="w-3 h-3" />}
                  value={current}
                  onChange={(v) => updateOverride(p.id, v)}
                  hint={
                    current
                      ? t("builder.postListEditor.thumbActive")
                      : t("builder.postListEditor.thumbEmpty")
                  }
                />
              </div>
            );
          })}
      </div>
    </Collapsible>
  );
}
