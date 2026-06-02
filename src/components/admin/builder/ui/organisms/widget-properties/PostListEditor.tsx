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
import { PropField, CollapsibleSection as Collapsible } from "../../atoms";
import { TaxonomyPicker } from "./TaxonomyPicker";

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
] as const;

const ORDER_BY = [
  { v: "published_at", l: "Data publikacji" },
  { v: "created_at", l: "Data utworzenia" },
  { v: "title", l: "Tytuł (alfabetycznie)" },
  { v: "random", l: "Losowo" },
] as const;

const POST_FORMATS = [
  { v: "", l: "— Wszystkie —" },
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
    (a.display_name && a.display_name.trim()) || a.email || "—";

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
          <PropField label="Kolumny">
            <Input
              type="number" min={1} max={6}
              value={columns}
              onChange={(e) => setContent("columns", Number(e.target.value) || 1)}
              className="h-8 text-xs"
            />
          </PropField>
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
              placeholder="— Brak —"
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
              placeholder="— Brak —"
            />
          </PropField>

          <div className="grid grid-cols-2 gap-2">
            <PropField label="Format wpisu">
              <Select value={postFormat || ""} onValueChange={(v) => setContent("postFormat", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POST_FORMATS.map((o) => (
                    <SelectItem key={o.v || "all"} value={o.v || "__all__"} className="text-xs">
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
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="— Wszyscy —" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__" className="text-xs">— Wszyscy —</SelectItem>
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
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground">
          {typeof matchCount === "number"
            ? `Pasujących wpisów: ${matchCount} • język podglądu: ${lang.toUpperCase()}`
            : "Liczenie pasujących wpisów…"}
        </div>
      </Collapsible>
    </div>
  );
}
