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
import { PropField, CollapsibleSection as Collapsible, ColorField } from "../../atoms";
import { AdminDatePicker } from "@/components/admin/blocks/AdminDatePicker";
import { IndexColorPreview } from "./IndexColorPreview";
import { TaxonomyPicker } from "./TaxonomyPicker";
import { ImageSlot } from "./ImageSlot";
import { readThumbnailOverrides, setThumbnailOverride } from "@/lib/builder/thumbnailOverrides";
import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
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

const ORDER_BY = ["published_at", "created_at", "title", "popular", "random"] as const;
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

function str(c: WidgetNode["content"], k: string, dflt = ""): string {
  const v = c[k];
  return typeof v === "string" ? v : dflt;
}
function num(c: WidgetNode["content"], k: string, dflt: number): number {
  const v = c[k];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return dflt;
}

export function PostListEditor({ c, lang, setContent }: Props) {
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
  const uniqueOnPage = c["uniqueOnPage"] === true || c["uniqueOnPage"] === "true";
  const mobileHScroll =
    c["mobileHorizontalScroll"] === true || c["mobileHorizontalScroll"] === "true";

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

  // Live count preview for current query (best-effort, lightweight).
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
    ],
  );
  const { data: matchCount } = useQuery({
    queryKey: ["post-list-editor-count", countKey],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "published");
      if (postFormat) q = q.eq("post_format", postFormat);
      if (authorId) q = q.eq("author_id", authorId);
      const inc = includeIdsCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (inc.length) q = q.in("id", inc);
      const exc = excludeIdsCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (exc.length) q = q.not("id", "in", `(${exc.join(",")})`);
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
      </Collapsible>
      {/* anchor */}

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
  const orderByRaw = str(c, "orderBy", "published_at");
  const orderDir = (str(c, "orderDir", "desc") === "asc" ? "asc" : "desc") as "asc" | "desc";
  const postFormat = str(c, "postFormat", "");
  const authorId = str(c, "authorId", "");
  const dateFrom = str(c, "dateFrom", "");
  const dateTo = str(c, "dateTo", "");
  const csv = (k: string) =>
    str(c, k, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const includeCats = csv("categoriesCsv");
  const excludeCats = csv("excludeCategoriesCsv");
  const includeTags = csv("tagsCsv");
  const excludeTags = csv("excludeTagsCsv");
  const includeIds = csv("includeIdsCsv");
  const excludeIds = csv("excludeIdsCsv");

  const overrides = readThumbnailOverrides(c);

  const queryKey = useMemo(
    () => [
      "post-list-editor-preview",
      {
        limit,
        offset,
        orderByRaw,
        orderDir,
        postFormat,
        authorId,
        dateFrom,
        dateTo,
        includeCats,
        excludeCats,
        includeTags,
        excludeTags,
        includeIds,
        excludeIds,
        lang,
      },
    ],
    [
      limit,
      offset,
      orderByRaw,
      orderDir,
      postFormat,
      authorId,
      dateFrom,
      dateTo,
      includeCats,
      excludeCats,
      includeTags,
      excludeTags,
      includeIds,
      excludeIds,
      lang,
    ],
  );

  const { data: rows = [], isLoading } = useQuery<PreviewRow[]>({
    queryKey,
    staleTime: 30_000,
    queryFn: async () => {
      const [incCatIds, incTagIds, excCatIds, excTagIds] = await Promise.all([
        resolveTaxonomyIds("post_categories", includeCats),
        resolveTaxonomyIds("post_tags", includeTags),
        resolveTaxonomyIds("post_categories", excludeCats),
        resolveTaxonomyIds("post_tags", excludeTags),
      ]);
      let includeSet: Set<string> | null = null;
      const seed = (s: Set<string>) => {
        includeSet = includeSet ? new Set([...includeSet].filter((x) => s.has(x))) : new Set(s);
      };
      if (includeCats.length) seed(incCatIds);
      if (includeTags.length) seed(incTagIds);
      if (includeIds.length) seed(new Set(includeIds));
      if (includeSet !== null && (includeSet as Set<string>).size === 0) return [];
      const excludeSet = new Set<string>([...excCatIds, ...excTagIds, ...excludeIds]);

      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, cover_image_url, author_id")
        .eq("status", "published");
      if (postFormat) q = q.eq("post_format", postFormat);
      if (authorId) q = q.eq("author_id", authorId);
      if (dateFrom) q = q.gte("published_at", `${dateFrom}T00:00:00Z`);
      if (dateTo) q = q.lte("published_at", `${dateTo}T23:59:59Z`);
      if (includeSet) q = q.in("id", Array.from(includeSet));
      if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);

      const orderCol =
        orderByRaw === "title"
          ? `title_${lang}`
          : orderByRaw === "random" || orderByRaw === "popular"
            ? "published_at"
            : orderByRaw;
      q = q.order(orderCol, { ascending: orderDir === "asc" });
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
