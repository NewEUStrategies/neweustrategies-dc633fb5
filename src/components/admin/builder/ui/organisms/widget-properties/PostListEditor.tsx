// Organism: post list / carousel query + display editor (Elementor-style).
// Owns query settings (categories, tags, exclusions, author, formats, order,
// limit, offset) plus display options (variant, columns). Persists everything
// on the widget content so PostListView can render the matching posts.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField, CollapsibleSection as Collapsible, ColorField } from "../../atoms";
import { TaxonomyPicker } from "./TaxonomyPicker";
import { ImageSlot } from "./ImageSlot";
import { readThumbnailOverrides, setThumbnailOverride } from "@/lib/builder/thumbnailOverrides";
import { Image as ImageIcon } from "lucide-react";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const VARIANTS = [
  { v: "card", l: "Karty" },
  { v: "minimal", l: "Minimalny" },
  { v: "overlay", l: "Overlay na okładce" },
  { v: "list", l: "Lista" },
  { v: "numbered", l: "Numerowana (01, 02)" },
] as const;

const ORDER_BY = [
  { v: "published_at", l: "Data publikacji" },
  { v: "created_at", l: "Data utworzenia" },
  { v: "title", l: "Tytuł (alfabetycznie)" },
  { v: "popular", l: "Popularność (odsłony)" },
  { v: "random", l: "Losowo" },
] as const;

const POST_FORMATS = [
  { v: "", l: "- Wszystkie -" },
  { v: "standard", l: "Standard" },
  { v: "video", l: "Wideo" },
  { v: "audio", l: "Audio" },
  { v: "gallery", l: "Galeria" },
  { v: "quote", l: "Cytat" },
] as const;

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
  const mobileHScroll = c["mobileHorizontalScroll"] === true || c["mobileHorizontalScroll"] === "true";

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
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .order("display_name", { ascending: true });
      return (data ?? []) as { id: string; display_name: string | null; email: string | null }[];
    },
  });

  const authorLabel = (a: { display_name: string | null; email: string | null }) =>
    (a.display_name && a.display_name.trim()) || a.email || "-";

  // Live count preview for current query (best-effort, lightweight).
  const countKey = useMemo(
    () => [
      "post-list-count",
      categoriesCsv, excludeCategoriesCsv, tagsCsv, excludeTagsCsv,
      includeIdsCsv, excludeIdsCsv, postFormat, authorId,
    ].join("|"),
    [categoriesCsv, excludeCategoriesCsv, tagsCsv, excludeTagsCsv, includeIdsCsv, excludeIdsCsv, postFormat, authorId],
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
      const inc = includeIdsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      if (inc.length) q = q.in("id", inc);
      const exc = excludeIdsCsv.split(",").map((s) => s.trim()).filter(Boolean);
      if (exc.length) q = q.not("id", "in", `(${exc.join(",")})`);
      const { count } = await q;
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-2">
      {/* ── Display ─────────────────────────────────────────── */}
      <Collapsible title="Wyświetlanie" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Wariant">
            <Select value={variant} onValueChange={(v) => setContent("variant", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VARIANTS.map((o) => (
                  <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropField>
          {variant !== "numbered" && variant !== "list" && (
            <PropField label="Kolumny">
              <Input
                type="number" min={1} max={6}
                value={columns}
                onChange={(e) => setContent("columns", Number(e.target.value) || 1)}
                className="h-8 text-xs"
              />
            </PropField>
          )}
        </div>
      </Collapsible>

      {/* ── Query ──────────────────────────────────────────── */}
      <Collapsible title="Filtry zapytania" defaultOpen>
        <div className="space-y-2">
          <PropField label="Kategorie (uwzględnij)">
            <TaxonomyPicker
              mode="categories"
              value={categoriesCsv}
              onChange={(v) => setContent("categoriesCsv", v)}
            />
          </PropField>
          <PropField label="Kategorie (wyklucz)">
            <TaxonomyPicker
              mode="categories"
              value={excludeCategoriesCsv}
              onChange={(v) => setContent("excludeCategoriesCsv", v)}
              placeholder="- Brak -"
            />
          </PropField>
          <PropField label="Tagi (uwzględnij)">
            <TaxonomyPicker
              mode="tags"
              value={tagsCsv}
              onChange={(v) => setContent("tagsCsv", v)}
            />
          </PropField>
          <PropField label="Tagi (wyklucz)">
            <TaxonomyPicker
              mode="tags"
              value={excludeTagsCsv}
              onChange={(v) => setContent("excludeTagsCsv", v)}
              placeholder="- Brak -"
            />
          </PropField>

          <div className="grid grid-cols-2 gap-2">
            <PropField label="Format wpisu">
              <Select
                value={postFormat || "__all__"}
                onValueChange={(v) => setContent("postFormat", v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POST_FORMATS.map((o) => (
                    <SelectItem key={o.v || "__all__"} value={o.v || "__all__"} className="text-xs">
                      {o.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
            <PropField label="Autor">
              <Select
                value={authorId || "__all__"}
                onValueChange={(v) => setContent("authorId", v === "__all__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="- Wszyscy -" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">- Wszyscy -</SelectItem>
                  {authors.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {authorLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
          </div>

          <PropField label="Konkretne wpisy (ID, po przecinku)" hint="Pokaż wyłącznie te wpisy.">
            <Input
              value={includeIdsCsv}
              placeholder="uuid1, uuid2"
              onChange={(e) => setContent("includeIdsCsv", e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </PropField>
          <PropField label="Wyklucz wpisy (ID, po przecinku)">
            <Input
              value={excludeIdsCsv}
              placeholder="uuid1, uuid2"
              onChange={(e) => setContent("excludeIdsCsv", e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </PropField>

          <div className="grid grid-cols-2 gap-2">
            <PropField label="Data od">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setContent("dateFrom", e.target.value)}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label="Data do">
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setContent("dateTo", e.target.value)}
                className="h-8 text-xs"
              />
            </PropField>
          </div>
        </div>
      </Collapsible>

      {/* ── Behaviour ──────────────────────────────────────── */}
      <Collapsible title="Zachowanie i unikalność" defaultOpen={false}>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={uniqueOnPage}
              onChange={(e) => setContent("uniqueOnPage", e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span>Nie powtarzaj wpisów z wcześniejszych widgetów na stronie</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={mobileHScroll}
              onChange={(e) => setContent("mobileHorizontalScroll", e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span>Tryb przewijania poziomego na mobile</span>
          </label>
          <div className="text-[10px] text-muted-foreground">
            Działa dla widoku kart / overlay / minimal. Na desktop nic się nie zmienia.
          </div>
        </div>
      </Collapsible>


      {/* ── Sort / paging ──────────────────────────────────── */}
      <Collapsible title="Sortowanie i ilość" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Sortuj wg">
            <Select value={orderBy} onValueChange={(v) => setContent("orderBy", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER_BY.map((o) => (
                  <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Kierunek">
            <Select
              value={orderDir}
              onValueChange={(v) => setContent("orderDir", v)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="desc" className="text-xs">Malejąco</SelectItem>
                <SelectItem value="asc" className="text-xs">Rosnąco</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Liczba wpisów">
            <Input
              type="number" min={1} max={100}
              value={limit}
              onChange={(e) => setContent("limit", Math.max(1, Number(e.target.value) || 1))}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label="Offset (pomiń N)">
            <Input
              type="number" min={0} max={1000}
              value={offset}
              onChange={(e) => setContent("offset", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 text-xs"
            />
          </PropField>
          {orderBy === "popular" && (
            <PropField label="Okres popularności (dni)">
              <Input
                type="number" min={1} max={365}
                value={popularDays}
                onChange={(e) => setContent("popularDays", Math.max(1, Number(e.target.value) || 30))}
                className="h-8 text-xs"
              />
            </PropField>
          )}
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground">
          {typeof matchCount === "number"
            ? `Pasujących wpisów: ${matchCount} • język podglądu: ${lang.toUpperCase()}`
            : "Liczenie pasujących wpisów…"}
        </div>
      </Collapsible>

      <PerPostThumbnailsSection c={c} lang={lang} setContent={setContent} />

      {/* ── Typografia tytułu i excerpt ───────────────────────── */}
      <Collapsible title="Styl tekstu (tytuł, excerpt)" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Rozmiar tytułu (px)">
            <Input
              type="number" min={10} max={48}
              value={num(c, "titleSizePx", 0) || ""}
              placeholder="auto"
              onChange={(e) => setContent("titleSizePx", Number(e.target.value) || 0)}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label="Grubość tytułu">
            <Select value={str(c, "titleWeight", "")} onValueChange={(v) => setContent("titleWeight", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="domyślna" /></SelectTrigger>
              <SelectContent>
                {["", "300", "400", "500", "600", "700", "800", "900"].map((w) => (
                  <SelectItem key={w || "default"} value={w} className="text-xs">{w || "domyślna"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Rozmiar excerpt (px)">
            <Input
              type="number" min={10} max={28}
              value={num(c, "excerptSizePx", 0) || ""}
              placeholder="auto"
              onChange={(e) => setContent("excerptSizePx", Number(e.target.value) || 0)}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label="Grubość excerpt">
            <Select value={str(c, "excerptWeight", "")} onValueChange={(v) => setContent("excerptWeight", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="domyślna" /></SelectTrigger>
              <SelectContent>
                {["", "300", "400", "500", "600", "700"].map((w) => (
                  <SelectItem key={w || "default"} value={w} className="text-xs">{w || "domyślna"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropField>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Działa we wszystkich wariantach (karty, lista, numerowana, overlay) - identycznie na desktop / tablet / mobile.
        </div>
      </Collapsible>

      {variant === "numbered" && (
        <Collapsible title="Numeracja (01, 02, 03…)" defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Rozmiar (px)">
              <Input
                type="number" min={12} max={240}
                value={num(c, "indexSizePx", 32)}
                onChange={(e) => setContent("indexSizePx", Number(e.target.value) || 0)}
                className="h-8 text-xs"
              />
            </PropField>
            <PropField label="Grubość">
              <Select value={str(c, "indexWeight", "700")} onValueChange={(v) => setContent("indexWeight", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["300","400","500","600","700","800","900"].map((w) => (
                    <SelectItem key={w} value={w}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropField>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <PropField label="Kolor (light)">
              <ColorField value={str(c, "indexColor", "")} onChange={(v) => setContent("indexColor", v ?? "")} />
            </PropField>
            <PropField label="Kolor (dark)">
              <ColorField value={str(c, "indexColorDark", "")} onChange={(v) => setContent("indexColorDark", v ?? "")} />
            </PropField>
          </div>
          <PropField label={`Przezroczystość (${Math.round(((num(c, "indexOpacity", -1) < 0 ? 0.05 : num(c, "indexOpacity", 0.05))) * 100)}%) - używana gdy brak własnego koloru`}>
            <Input
              type="range" min={0} max={1} step={0.01}
              value={num(c, "indexOpacity", -1) < 0 ? 0.05 : num(c, "indexOpacity", 0.05)}
              onChange={(e) => setContent("indexOpacity", Number(e.target.value))}
              className="h-6"
            />
          </PropField>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Puste pole koloru = automatyczne dopasowanie do trybu jasnego/ciemnego z ustawioną przezroczystością.
          </div>
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
}

async function resolveTaxonomyIds(table: "post_categories" | "post_tags", slugs: string[]): Promise<Set<string>> {
  if (!slugs.length) return new Set();
  if (table === "post_categories") {
    const { data: cats } = await supabase.from("categories").select("id").in("slug", slugs);
    const ids = (cats ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return new Set();
    const { data: links } = await supabase.from("post_categories").select("post_id").in("category_id", ids);
    return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
  }
  const { data: tags } = await supabase.from("tags").select("id").in("slug", slugs);
  const ids = (tags ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) return new Set();
  const { data: links } = await supabase.from("post_tags").select("post_id").in("tag_id", ids);
  return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
}

function PerPostThumbnailsSection({ c, lang, setContent }: Props) {
  const limit = Math.max(1, Math.min(100, num(c, "limit", 6)));
  const offset = Math.max(0, num(c, "offset", 0));
  const orderByRaw = str(c, "orderBy", "published_at");
  const orderDir = (str(c, "orderDir", "desc") === "asc" ? "asc" : "desc") as "asc" | "desc";
  const postFormat = str(c, "postFormat", "");
  const authorId = str(c, "authorId", "");
  const dateFrom = str(c, "dateFrom", "");
  const dateTo = str(c, "dateTo", "");
  const csv = (k: string) => str(c, k, "").split(",").map((s) => s.trim()).filter(Boolean);
  const includeCats = csv("categoriesCsv");
  const excludeCats = csv("excludeCategoriesCsv");
  const includeTags = csv("tagsCsv");
  const excludeTags = csv("excludeTagsCsv");
  const includeIds = csv("includeIdsCsv");
  const excludeIds = csv("excludeIdsCsv");

  const overrides = readThumbnailOverrides(c);

  const queryKey = useMemo(
    () => ["post-list-editor-preview", {
      limit, offset, orderByRaw, orderDir, postFormat, authorId, dateFrom, dateTo,
      includeCats, excludeCats, includeTags, excludeTags, includeIds, excludeIds, lang,
    }],
    [limit, offset, orderByRaw, orderDir, postFormat, authorId, dateFrom, dateTo,
     includeCats, excludeCats, includeTags, excludeTags, includeIds, excludeIds, lang],
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
        .select("id, slug, title_pl, title_en, cover_image_url")
        .eq("status", "published");
      if (postFormat) q = q.eq("post_format", postFormat);
      if (authorId) q = q.eq("author_id", authorId);
      if (dateFrom) q = q.gte("published_at", `${dateFrom}T00:00:00Z`);
      if (dateTo) q = q.lte("published_at", `${dateTo}T23:59:59Z`);
      if (includeSet) q = q.in("id", Array.from(includeSet));
      if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);

      const orderCol =
        orderByRaw === "title" ? `title_${lang}`
        : orderByRaw === "random" || orderByRaw === "popular" ? "published_at"
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

  return (
    <Collapsible title="Miniatury (override per wpis)" defaultOpen={false}>
      <div className="space-y-3">
        <div className="text-[10px] text-muted-foreground">
          Nadpisz miniaturkę okładki indywidualnie dla każdego wpisu wyświetlanego w tym widgecie. Puste pole = oryginalna okładka wpisu.
        </div>
        {isLoading && <div className="text-xs text-muted-foreground">Ładowanie…</div>}
        {!isLoading && rows.length === 0 && (
          <div className="text-xs text-muted-foreground">Brak wpisów do nadpisania.</div>
        )}
        {rows.map((p) => {
          const current = overrides[p.id] || "";
          const preview = current || p.cover_image_url || "";
          return (
            <div key={p.id} className="rounded-md border border-border p-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative w-14 aspect-[4/3] shrink-0 overflow-hidden rounded-sm bg-muted">
                  {preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{titleOf(p)}</div>
                  <div className="text-[10px] text-muted-foreground truncate font-mono">{p.slug}</div>
                </div>
              </div>
              <ImageSlot
                label="Miniatura (override)"
                icon={<ImageIcon className="w-3 h-3" />}
                value={current}
                onChange={(v) => updateOverride(p.id, v)}
                hint={current ? "Nadpisana miniatura aktywna." : "Puste = oryginalna okładka wpisu."}
              />
            </div>
          );
        })}
      </div>
    </Collapsible>
  );
}
