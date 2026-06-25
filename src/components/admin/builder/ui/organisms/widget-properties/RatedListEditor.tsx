// Organism: rated/ranked list editor (manual + dynamic source, full styling).
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField, ColorField, ItemFrame, CollapsibleSection as Collapsible } from "../../atoms";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { TaxonomyPicker } from "./TaxonomyPicker";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function RatedListEditor({ c, lang, setContent }: Props) {
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", next as unknown as Json);
  const upd = (i: number, patch: Partial<Item>) =>
    update(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const source = typeof c.source === "string" ? c.source : "manual";
  const showRating = c.showRating !== false;

  const numFont = typeof c.numberFont === "string" ? c.numberFont : "display";
  const numWeight = typeof c.numberWeight === "string" ? c.numberWeight : "700";
  const numSize = typeof c.numberSizePx === "number" ? c.numberSizePx : 48;
  const numColor = typeof c.numberColor === "string" ? c.numberColor : "#000000";
  const numColorDark = typeof c.numberColorDark === "string" ? c.numberColorDark : "#ffffff";
  const numOpacity = typeof c.numberOpacity === "number" ? c.numberOpacity : 0.05;
  const numPos = typeof c.numberPosition === "string" ? c.numberPosition : "behind";

  const txt = (k: string, d = "") => typeof c[k] === "string" ? (c[k] as string) : d;
  const num = (k: string, d: number) => typeof c[k] === "number" ? (c[k] as number) : d;
  const bool = (k: string, d: boolean) => typeof c[k] === "boolean" ? (c[k] as boolean) : d;

  // Reference to keep showRating visible (was used implicitly by the old layout)
  void showRating;

  return (
    <div className="space-y-3">
      {/* Źródło danych */}
      <div className="space-y-2 border border-border rounded-md p-2 bg-background">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Źródło danych</div>
        <PropField label="Skąd brać materiały">
          <Select value={source} onValueChange={(v) => setContent("source", v as Json)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Ręczna lista pozycji</SelectItem>
              <SelectItem value="dynamic">Dynamicznie z wpisów</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={c.showRating !== false} onChange={(e) => setContent("showRating", e.target.checked as Json)} />
          Pokazuj ocenę (paski + liczba)
        </label>
      </div>

      {source === "dynamic" && (
        <div className="space-y-2 border border-border rounded-md p-2 bg-background">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Query Settings</div>
          <PropField label="Categories Filter">
            <TaxonomyPicker mode="categories" value={txt("categoriesFilter")} onChange={(v) => setContent("categoriesFilter", v as Json)} />
          </PropField>
          <PropField label="Exclude Categories">
            <TaxonomyPicker mode="categories" value={txt("excludeCategories")} onChange={(v) => setContent("excludeCategories", v as Json)} placeholder="- Nic nie wykluczaj -" />
          </PropField>
          <PropField label="Tags Filter">
            <TaxonomyPicker mode="tags" value={txt("tagsFilter")} onChange={(v) => setContent("tagsFilter", v as Json)} />
          </PropField>
          <PropField label="Exclude Tags">
            <TaxonomyPicker mode="tags" value={txt("excludeTags")} onChange={(v) => setContent("excludeTags", v as Json)} placeholder="- Nic nie wykluczaj -" />
          </PropField>
          <PropField label="Post Format">
            <Select value={txt("postFormatFilter") || "all"} onValueChange={(v) => setContent("postFormatFilter", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="video">Wideo</SelectItem>
                <SelectItem value="gallery">Galeria</SelectItem>
                <SelectItem value="quote">Cytat</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="link">Link</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Author Filter (nazwy autorów, csv)">
            <Input value={txt("authorFilter")} onChange={(e) => setContent("authorFilter", e.target.value as Json)} className="h-8 text-xs" placeholder="Imię Nazwisko, Inna Osoba" />
          </PropField>
          <PropField label="Post IDs Filter (UUID, csv)">
            <Input value={txt("postIdsFilter")} onChange={(e) => setContent("postIdsFilter", e.target.value as Json)} className="h-8 text-xs" placeholder="uuid1,uuid2" />
          </PropField>
          <PropField label="Exclude Post IDs (UUID, csv)">
            <Input value={txt("excludePostIds")} onChange={(e) => setContent("excludePostIds", e.target.value as Json)} className="h-8 text-xs" placeholder="uuid1,uuid2" />
          </PropField>
          <div className="grid grid-cols-2 gap-2">
            <PropField label="Order By">
              <Select value={txt("orderBy") || "last_published"} onValueChange={(v) => setContent("orderBy", v as Json)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="last_published">Ostatnio publikowane</SelectItem>
                  <SelectItem value="title_asc">Tytuł A→Z</SelectItem>
                  <SelectItem value="title_desc">Tytuł Z→A</SelectItem>
                  <SelectItem value="random">Losowo</SelectItem>
                </SelectContent>
              </Select>
            </PropField>
            <PropField label="Number of Posts">
              <Input type="number" min={1} max={50} value={num("numberOfPosts", 4)}
                onChange={(e) => setContent("numberOfPosts", (Number(e.target.value) || 1) as Json)} className="h-8 text-xs" />
            </PropField>
            <PropField label="Post Offset">
              <Input type="number" min={0} value={num("postOffset", 0)}
                onChange={(e) => setContent("postOffset", (Number(e.target.value) || 0) as Json)} className="h-8 text-xs" />
            </PropField>
          </div>
        </div>
      )}

      {/* ===== STYL ===== */}
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-2">Styl elementów</div>

      <Collapsible title="Index Counter (numeracja)" defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Font">
            <Select value={numFont} onValueChange={(v) => setContent("numberFont", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="display">Display</SelectItem>
                <SelectItem value="sans">Sans</SelectItem>
                <SelectItem value="serif">Serif</SelectItem>
                <SelectItem value="mono">Mono</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Grubość">
            <Select value={numWeight} onValueChange={(v) => setContent("numberWeight", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["300","400","500","600","700","800","900"].map((w) => (<SelectItem key={w} value={w}>{w}</SelectItem>))}
              </SelectContent>
            </Select>
          </PropField>
          <PropField label="Rozmiar (px)">
            <Input type="number" min={12} max={240} value={numSize}
              onChange={(e) => setContent("numberSizePx", (Number(e.target.value) || 0) as Json)} className="h-8 text-xs" />
          </PropField>
          <PropField label="Pozycja">
            <Select value={numPos} onValueChange={(v) => setContent("numberPosition", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="behind">Za treścią (prawy róg)</SelectItem>
                <SelectItem value="left">Z lewej obok</SelectItem>
                <SelectItem value="top">Nad tytułem</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor (light)"><ColorField value={numColor} onChange={(v) => setContent("numberColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Kolor (dark)"><ColorField value={numColorDark} onChange={(v) => setContent("numberColorDark", (v ?? "") as Json)} /></PropField>
        </div>
        <PropField label={`Przezroczystość (${Math.round(numOpacity * 100)}%)`}>
          <Input type="range" min={0} max={1} step={0.01} value={numOpacity}
            onChange={(e) => setContent("numberOpacity", (Number(e.target.value) || 0) as Json)} className="h-6" />
        </PropField>
      </Collapsible>

      <Collapsible title="Entry Category (kategoria)">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("showCategory", false)} onChange={(e) => setContent("showCategory", e.target.checked as Json)} />
          Pokazuj kategorię nad tytułem
        </label>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor tekstu"><ColorField value={txt("categoryColor", "#dc2626")} onChange={(v) => setContent("categoryColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Kolor (dark)"><ColorField value={txt("categoryColorDark", "#f87171")} onChange={(v) => setContent("categoryColorDark", (v ?? "") as Json)} /></PropField>
          <PropField label="Rozmiar (px)"><Input type="number" min={8} max={32} value={num("categorySizePx", 11)} onChange={(e) => setContent("categorySizePx", (Number(e.target.value) || 11) as Json)} className="h-8 text-xs" /></PropField>
          <PropField label="Grubość">
            <Select value={txt("categoryWeight", "700")} onValueChange={(v) => setContent("categoryWeight", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{["400","500","600","700","800","900"].map((w) => (<SelectItem key={w} value={w}>{w}</SelectItem>))}</SelectContent>
            </Select>
          </PropField>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("categoryUppercase", true)} onChange={(e) => setContent("categoryUppercase", e.target.checked as Json)} />
          UPPERCASE
        </label>
      </Collapsible>

      <Collapsible title="Post Title (tytuł)">
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor (light)"><ColorField value={txt("titleColor", "")} onChange={(v) => setContent("titleColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Kolor (dark)"><ColorField value={txt("titleColorDark", "")} onChange={(v) => setContent("titleColorDark", (v ?? "") as Json)} /></PropField>
          <PropField label="Hover"><ColorField value={txt("titleHoverColor", "")} onChange={(v) => setContent("titleHoverColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Rozmiar (px)"><Input type="number" min={10} max={48} value={num("titleSizePx", 18)} onChange={(e) => setContent("titleSizePx", (Number(e.target.value) || 18) as Json)} className="h-8 text-xs" /></PropField>
          <PropField label="Grubość">
            <Select value={txt("titleWeight", "700")} onValueChange={(v) => setContent("titleWeight", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{["400","500","600","700","800","900"].map((w) => (<SelectItem key={w} value={w}>{w}</SelectItem>))}</SelectContent>
            </Select>
          </PropField>
          <PropField label="Font">
            <Select value={txt("titleFont", "display")} onValueChange={(v) => setContent("titleFont", v as Json)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="display">Display</SelectItem>
                <SelectItem value="sans">Sans</SelectItem>
                <SelectItem value="serif">Serif</SelectItem>
                <SelectItem value="mono">Mono</SelectItem>
              </SelectContent>
            </Select>
          </PropField>
        </div>
      </Collapsible>

      <Collapsible title="Entry Meta (autor / data)">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("showAuthor", true)} onChange={(e) => setContent("showAuthor", e.target.checked as Json)} />
          Pokazuj autora
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("showDate", false)} onChange={(e) => setContent("showDate", e.target.checked as Json)} />
          Pokazuj datę publikacji
        </label>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor (light)"><ColorField value={txt("metaColor", "")} onChange={(v) => setContent("metaColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Kolor (dark)"><ColorField value={txt("metaColorDark", "")} onChange={(v) => setContent("metaColorDark", (v ?? "") as Json)} /></PropField>
          <PropField label="Rozmiar (px)"><Input type="number" min={8} max={20} value={num("metaSizePx", 12)} onChange={(e) => setContent("metaSizePx", (Number(e.target.value) || 12) as Json)} className="h-8 text-xs" /></PropField>
        </div>
      </Collapsible>

      <Collapsible title="Excerpt (zajawka)">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("showExcerpt", true)} onChange={(e) => setContent("showExcerpt", e.target.checked as Json)} />
          Pokazuj zajawkę
        </label>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor (light)"><ColorField value={txt("excerptColor", "")} onChange={(v) => setContent("excerptColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Kolor (dark)"><ColorField value={txt("excerptColorDark", "")} onChange={(v) => setContent("excerptColorDark", (v ?? "") as Json)} /></PropField>
          <PropField label="Rozmiar (px)"><Input type="number" min={10} max={20} value={num("excerptSizePx", 13)} onChange={(e) => setContent("excerptSizePx", (Number(e.target.value) || 13) as Json)} className="h-8 text-xs" /></PropField>
          <PropField label="Linie (clamp)"><Input type="number" min={1} max={10} value={num("excerptLines", 3)} onChange={(e) => setContent("excerptLines", (Number(e.target.value) || 3) as Json)} className="h-8 text-xs" /></PropField>
        </div>
      </Collapsible>

      <Collapsible title="Read More (link)">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("showReadMore", false)} onChange={(e) => setContent("showReadMore", e.target.checked as Json)} />
          Pokazuj „Czytaj więcej”
        </label>
        <PropField label={`Tekst (${lang.toUpperCase()})`}>
          <Input value={txt(`readMoreText_${lang}`, lang === "pl" ? "Czytaj więcej" : "Read more")}
            onChange={(e) => setContent(`readMoreText_${lang}`, e.target.value as Json)} className="h-8 text-xs" />
        </PropField>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor (light)"><ColorField value={txt("readMoreColor", "")} onChange={(v) => setContent("readMoreColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Kolor (dark)"><ColorField value={txt("readMoreColorDark", "")} onChange={(v) => setContent("readMoreColorDark", (v ?? "") as Json)} /></PropField>
        </div>
      </Collapsible>

      <Collapsible title="Bookmark (zakładka)">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("showBookmark", false)} onChange={(e) => setContent("showBookmark", e.target.checked as Json)} />
          Pokazuj ikonę zakładki
        </label>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor"><ColorField value={txt("bookmarkColor", "")} onChange={(v) => setContent("bookmarkColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Rozmiar (px)"><Input type="number" min={10} max={32} value={num("bookmarkSizePx", 16)} onChange={(e) => setContent("bookmarkSizePx", (Number(e.target.value) || 16) as Json)} className="h-8 text-xs" /></PropField>
        </div>
      </Collapsible>

      <Collapsible title="Post Format (ikona formatu)">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={bool("showPostFormat", false)} onChange={(e) => setContent("showPostFormat", e.target.checked as Json)} />
          Pokazuj ikonę formatu (wideo / galeria itd.)
        </label>
        <PropField label="Kolor ikony"><ColorField value={txt("postFormatColor", "")} onChange={(v) => setContent("postFormatColor", (v ?? "") as Json)} /></PropField>
      </Collapsible>

      <Collapsible title="Text Color Scheme (schemat)">
        <PropField label="Schemat">
          <Select value={txt("colorScheme", "auto")} onValueChange={(v) => setContent("colorScheme", v as Json)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (dziedzicz)</SelectItem>
              <SelectItem value="light">Wymuś jasny</SelectItem>
              <SelectItem value="dark">Wymuś ciemny</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </Collapsible>

      {/* ===== UKŁAD ===== */}
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-2">Układ</div>

      <Collapsible title="Columns (kolumny)">
        <div className="grid grid-cols-3 gap-2">
          <PropField label="Desktop"><Input type="number" min={1} max={6} value={num("columnsDesktop", 1)} onChange={(e) => setContent("columnsDesktop", (Number(e.target.value) || 1) as Json)} className="h-8 text-xs" /></PropField>
          <PropField label="Tablet"><Input type="number" min={1} max={6} value={num("columnsTablet", 1)} onChange={(e) => setContent("columnsTablet", (Number(e.target.value) || 1) as Json)} className="h-8 text-xs" /></PropField>
          <PropField label="Mobile"><Input type="number" min={1} max={3} value={num("columnsMobile", 1)} onChange={(e) => setContent("columnsMobile", (Number(e.target.value) || 1) as Json)} className="h-8 text-xs" /></PropField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Column gap (px)"><Input type="number" min={0} max={120} value={num("columnGapPx", 24)} onChange={(e) => setContent("columnGapPx", (Number(e.target.value) || 0) as Json)} className="h-8 text-xs" /></PropField>
          <PropField label="Row gap (px)"><Input type="number" min={0} max={120} value={num("rowGapPx", 28)} onChange={(e) => setContent("rowGapPx", (Number(e.target.value) || 0) as Json)} className="h-8 text-xs" /></PropField>
        </div>
      </Collapsible>

      <Collapsible title="Grid Borders (separatory)">
        <PropField label="Tryb">
          <Select value={txt("gridBorders", "none")} onValueChange={(v) => setContent("gridBorders", v as Json)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brak</SelectItem>
              <SelectItem value="between">Między elementami</SelectItem>
              <SelectItem value="full">Pełna ramka</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Kolor"><ColorField value={txt("gridBorderColor", "")} onChange={(v) => setContent("gridBorderColor", (v ?? "") as Json)} /></PropField>
          <PropField label="Grubość (px)"><Input type="number" min={0} max={8} value={num("gridBorderWidthPx", 1)} onChange={(e) => setContent("gridBorderWidthPx", (Number(e.target.value) || 0) as Json)} className="h-8 text-xs" /></PropField>
        </div>
      </Collapsible>

      <Collapsible title="Spacing (odstępy)">
        <PropField label={`Odstęp między pozycjami (px) - ${num("itemSpacingPx", 28)}`}>
          <Input type="range" min={0} max={80} step={1} value={num("itemSpacingPx", 28)}
            onChange={(e) => setContent("itemSpacingPx", (Number(e.target.value) || 0) as Json)} className="h-6" />
        </PropField>
        <PropField label={`Padding wewnątrz pozycji (px) - ${num("itemPaddingPx", 0)}`}>
          <Input type="range" min={0} max={40} step={1} value={num("itemPaddingPx", 0)}
            onChange={(e) => setContent("itemPaddingPx", (Number(e.target.value) || 0) as Json)} className="h-6" />
        </PropField>
      </Collapsible>

      <Collapsible title="Scrolling Mode">
        <PropField label="Tryb">
          <Select value={txt("scrollingMode", "none")} onValueChange={(v) => setContent("scrollingMode", v as Json)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brak (cała lista)</SelectItem>
              <SelectItem value="scroll">Wewnętrzny scroll</SelectItem>
              <SelectItem value="loadmore">Load more</SelectItem>
              <SelectItem value="carousel">Karuzela pozioma</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        {txt("scrollingMode", "none") === "scroll" && (
          <PropField label="Max wysokość (px)">
            <Input type="number" min={120} max={1200} value={num("scrollMaxHeightPx", 400)} onChange={(e) => setContent("scrollMaxHeightPx", (Number(e.target.value) || 400) as Json)} className="h-8 text-xs" />
          </PropField>
        )}
        {txt("scrollingMode", "none") === "loadmore" && (
          <PropField label="Pozycji na stronę">
            <Input type="number" min={1} max={50} value={num("pageSize", 4)} onChange={(e) => setContent("pageSize", (Number(e.target.value) || 4) as Json)} className="h-8 text-xs" />
          </PropField>
        )}
      </Collapsible>

      {source === "manual" && (
        <ListShell
          title="Pozycje listy"
          items={items}
          onAdd={() => update([...items, { title_pl: "Nowa pozycja", title_en: "New item", excerpt_pl: "", excerpt_en: "", author: "", rating: 0 }])}
        >
          <div className="space-y-2">
            {items.map((it, i) => (
              <ItemFrame key={i} title={`Pozycja #${i + 1}`} onRemove={() => update(items.filter((_, j) => j !== i))}>
                <PropField label={`Tytuł (${lang.toUpperCase()})`}>
                  <Input value={typeof it[`title_${lang}`] === "string" ? (it[`title_${lang}`] as string) : ""}
                    onChange={(e) => upd(i, { [`title_${lang}`]: e.target.value })} className="h-8 text-xs" />
                </PropField>
                <PropField label={`Zajawka (${lang.toUpperCase()})`}>
                  <Textarea rows={2} value={typeof it[`excerpt_${lang}`] === "string" ? (it[`excerpt_${lang}`] as string) : ""}
                    onChange={(e) => upd(i, { [`excerpt_${lang}`]: e.target.value })} className="text-xs" />
                </PropField>
                <PropField label={`Kategoria (${lang.toUpperCase()})`}>
                  <Input value={typeof it[`category_${lang}`] === "string" ? (it[`category_${lang}`] as string) : ""}
                    onChange={(e) => upd(i, { [`category_${lang}`]: e.target.value })} className="h-8 text-xs" placeholder="Raport, Analiza..." />
                </PropField>
                <div className="grid grid-cols-2 gap-2">
                  <PropField label="Autor">
                    <Input value={typeof it.author === "string" ? it.author : ""} onChange={(e) => upd(i, { author: e.target.value })} className="h-8 text-xs" />
                  </PropField>
                  <PropField label="Ocena (0–10)">
                    <Input type="number" min={0} max={10} step={0.1}
                      value={typeof it.rating === "number" ? it.rating : 0}
                      onChange={(e) => upd(i, { rating: Number(e.target.value) || 0 })} className="h-8 text-xs" />
                  </PropField>
                  <PropField label="Data (YYYY-MM-DD)">
                    <Input value={typeof it.date === "string" ? it.date : ""} onChange={(e) => upd(i, { date: e.target.value })} className="h-8 text-xs" placeholder="2025-01-15" />
                  </PropField>
                  <PropField label="Format">
                    <Select value={typeof it.format === "string" ? it.format : "standard"} onValueChange={(v) => upd(i, { format: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="video">Wideo</SelectItem>
                        <SelectItem value="gallery">Galeria</SelectItem>
                        <SelectItem value="quote">Cytat</SelectItem>
                        <SelectItem value="audio">Audio</SelectItem>
                        <SelectItem value="link">Link</SelectItem>
                      </SelectContent>
                    </Select>
                  </PropField>
                </div>
              </ItemFrame>
            ))}
          </div>
        </ListShell>
      )}
    </div>
  );
}
