// Molecule: Lucide icon picker with keyword-based categories.
// Popover with search + category tabs + grid of Lucide icons.
// Stores the icon name in kebab-case (compatible with DynamicIcon resolver).
import { useMemo, useState } from "react";
import * as LucideIcons from "lucide-react";
import { Search, X, HelpCircle, type LucideProps } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";

type IconComponent = React.ComponentType<LucideProps>;

function pascalToKebab(pascal: string): string {
  return pascal
    .replace(/Icon$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

// Lucide ships ~1500+ icon exports. Enumerating them (Object.keys + a regex per
// name) MUST NOT run at module-initialization time: this file is pulled into the
// eagerly-imported route-module graph (Builder → SectionProperties → TabsPane →
// LucideIconPicker), which the framework loads via getEntries() on the first SSR
// request. On the Cloudflare Worker (workerd) runtime that first load runs inside
// a strict global-scope startup budget, and doing this whole-namespace scan at
// module top level deterministically blew it — rejecting the route-module load and
// 500-ing the entire site with h3's opaque, self-poisoning "HTTPError" (works in
// local Node SSR, fails only on workerd). The picker only ever renders in the
// admin UI on the client, so compute it lazily on first use instead — the import
// itself now does no heavy work.
let _allIconNames: string[] | null = null;
function getAllIconNames(): string[] {
  if (_allIconNames) return _allIconNames;
  const reg = LucideIcons as unknown as Record<string, unknown>;
  const set = new Set<string>();
  for (const key of Object.keys(reg)) {
    if (!key.endsWith("Icon")) continue;
    const val = reg[key];
    if (typeof val !== "function" && typeof val !== "object") continue;
    const kebab = pascalToKebab(key);
    if (kebab && /^[a-z0-9-]+$/.test(kebab)) set.add(kebab);
  }
  _allIconNames = Array.from(set).sort();
  return _allIconNames;
}

// Category definitions - keyword patterns matched against icon names.
// Order matters: first matching category wins. Everything else falls to "other".
interface Category {
  id: string;
  label: string;
  icon: string;
  patterns: RegExp[];
}

const CATEGORIES: Category[] = [
  { id: "arrows", label: "Strzałki", icon: "arrow-right", patterns: [/^arrow/, /^chevron/, /^move/, /^corner/, /^redo/, /^undo/, /^rotate/, /-arrow/] },
  { id: "layout", label: "Layout", icon: "layout-grid", patterns: [/^layout/, /^grid/, /^columns/, /^rows/, /^panel/, /^sidebar/, /^align/, /^table/, /^kanban/, /^dashboard/] },
  { id: "text", label: "Tekst", icon: "type", patterns: [/^type/, /^heading/, /^text/, /^bold/, /^italic/, /^underline/, /^strikethrough/, /^list/, /^quote/, /^pilcrow/, /^case/, /^font/, /^letter/, /^paragraph/, /^wrap-text/, /^indent/, /^subscript/, /^superscript/, /^whole-word/] },
  { id: "media", label: "Media", icon: "film", patterns: [/^camera/, /^image/, /^video/, /^film/, /^tv/, /^music/, /^audio/, /^headphones/, /^mic/, /^volume/, /^speaker/, /^play/, /^pause/, /^stop-circle/, /^skip/, /^rewind/, /^fast-forward/, /^radio/, /^cast/, /^disc/, /^podcast/, /^gallery/, /^clapperboard/, /^guitar/, /^piano/, /^drum/, /^theater/] },
  { id: "files", label: "Pliki", icon: "folder", patterns: [/^file/, /^folder/, /^archive/, /^clipboard/, /^paperclip/, /^book/, /^library/, /^notebook/, /^scroll/, /^sticky-note/, /^bookmark/, /^newspaper/, /^receipt/] },
  { id: "communication", label: "Komunikacja", icon: "mail", patterns: [/^mail/, /^message/, /^send/, /^inbox/, /^bell/, /^at-sign/, /^phone/, /^voicemail/, /^rss/, /^megaphone/, /^speech/, /^reply/, /^forward/, /^signal/] },
  { id: "users", label: "Ludzie", icon: "users", patterns: [/^user/, /^users/, /^person/, /^contact/, /^baby/, /^accessibility/, /^footprints/, /^hand/, /^ear/, /^smile/, /^laugh/, /^frown/, /^angry/, /^annoyed/, /^meh/, /^venetian-mask/, /^drama/, /^persistent-avatar/, /^cat/, /^dog/, /^bird/, /^fish/, /^rabbit/, /^turtle/, /^squirrel/, /^snail/, /^bug/, /^worm/, /^rat/, /^origami/] },
  { id: "shopping", label: "Zakupy", icon: "shopping-bag", patterns: [/^shopping/, /^cart/, /^store/, /^shop/, /^gift/, /^tag/, /^ticket/, /^package/, /^shirt/, /^wallet/, /^credit-card/, /^coins/, /^banknote/, /^piggy/, /^dollar/, /^euro/, /^pound/, /^yen/, /^bitcoin/, /^currency/, /^receipt/, /^percent/, /^badge/, /^scan/] },
  { id: "devices", label: "Urządzenia", icon: "laptop", patterns: [/^laptop/, /^computer/, /^monitor/, /^smartphone/, /^tablet/, /^watch/, /^printer/, /^scanner/, /^mouse/, /^keyboard/, /^gamepad/, /^joystick/, /^webcam/, /^usb/, /^hard-drive/, /^cpu/, /^memory-stick/, /^floppy/, /^server/, /^router/, /^plug/, /^power/, /^battery/, /^cable/, /^ethernet/, /^bluetooth/, /^wifi/, /^rss/, /^cast/, /^screen/, /^smart/, /^remote/] },
  { id: "nature", label: "Natura", icon: "leaf", patterns: [/^tree/, /^leaf/, /^flower/, /^cherry/, /^flame/, /^cloud/, /^sun/, /^moon/, /^star/, /^snow/, /^rain/, /^droplet/, /^droplets/, /^wind/, /^waves/, /^mountain/, /^globe/, /^earth/, /^planet/, /^milestone/, /^sprout/, /^leafy/, /^cactus/, /^palm/, /^grape/, /^apple/, /^banana/, /^carrot/, /^orange/, /^lemon/, /^egg/, /^wheat/, /^clover/, /^shell/, /^feather/, /^bone/, /^paw-print/, /^umbrella/, /^rainbow/, /^tornado/, /^haze/, /^fog/] },
  { id: "tools", label: "Narzędzia", icon: "wrench", patterns: [/^wrench/, /^hammer/, /^screwdriver/, /^drill/, /^saw/, /^ruler/, /^pencil/, /^pen/, /^brush/, /^paintbrush/, /^paint/, /^palette/, /^eraser/, /^pipette/, /^scissors/, /^knife/, /^axe/, /^magnet/, /^wand/, /^cog/, /^settings/, /^sliders/, /^toggle/, /^bolt/, /^plug/, /^stethoscope/, /^syringe/, /^microscope/, /^telescope/, /^binoculars/, /^compass/, /^flashlight/, /^lamp/] },
  { id: "shapes", label: "Kształty", icon: "shapes", patterns: [/^square/, /^circle/, /^triangle/, /^hexagon/, /^octagon/, /^pentagon/, /^diamond/, /^shapes/, /^spline/, /^ligature/, /^box/, /^cylinder/, /^cone/, /^torus/, /^sphere/, /^ampersand/, /^asterisk/, /^slash/] },
  { id: "map", label: "Mapy", icon: "map", patterns: [/^map/, /^pin/, /^locate/, /^navigation/, /^compass/, /^route/, /^milestone/, /^flag/, /^building/, /^house/, /^home/, /^landmark/, /^castle/, /^church/, /^hotel/, /^school/, /^warehouse/, /^factory/, /^office/, /^tent/, /^waypoints/] },
  { id: "transport", label: "Transport", icon: "car", patterns: [/^car/, /^bus/, /^truck/, /^bike/, /^bicycle/, /^scooter/, /^plane/, /^ship/, /^sailboat/, /^rocket/, /^fuel/, /^parking/, /^train/, /^tram/, /^caravan/, /^ambulance/, /^taxi/, /^helicopter/, /^anchor/, /^gauge/, /^footprints/, /^traffic/] },
  { id: "food", label: "Jedzenie", icon: "utensils", patterns: [/^coffee/, /^cup/, /^wine/, /^beer/, /^martini/, /^milk/, /^candy/, /^cake/, /^cookie/, /^pizza/, /^sandwich/, /^salad/, /^soup/, /^egg/, /^ice-cream/, /^dessert/, /^popcorn/, /^utensils/, /^chef/, /^ham/, /^beef/, /^drumstick/, /^croissant/, /^donut/, /^pretzel/, /^lollipop/, /^bean/] },
  { id: "sport", label: "Sport", icon: "trophy", patterns: [/^dumbbell/, /^trophy/, /^medal/, /^award/, /^target/, /^flag/, /^gamepad/, /^tent/, /^backpack/, /^bike/, /^ski/, /^snowflake/, /^volleyball/, /^football/, /^basketball/, /^tennis/, /^golf/, /^goal/, /^whistle/, /^stopwatch/, /^timer/] },
  { id: "security", label: "Bezpieczeństwo", icon: "shield", patterns: [/^lock/, /^unlock/, /^key/, /^shield/, /^scan/, /^fingerprint/, /^eye/, /^eye-off/, /^radar/, /^bug/, /^alert/, /^ban/] },
  { id: "charts", label: "Wykresy", icon: "bar-chart-3", patterns: [/^chart/, /^bar-chart/, /^line-chart/, /^pie-chart/, /^area-chart/, /^scatter/, /^radar/, /^trending/, /^activity/, /^gauge/, /^sigma/, /^calculator/, /^binary/, /^percent/] },
  { id: "time", label: "Czas", icon: "clock", patterns: [/^clock/, /^watch/, /^timer/, /^stopwatch/, /^calendar/, /^hourglass/, /^alarm/, /^history/] },
  { id: "weather", label: "Pogoda", icon: "cloud-sun", patterns: [/^sun/, /^moon/, /^cloud/, /^rain/, /^snow/, /^thermometer/, /^umbrella/, /^wind/, /^tornado/, /^haze/, /^fog/, /^rainbow/, /^cloudy/, /^drizzle/, /^lightning/, /^droplet/] },
];

interface Grouped {
  id: string;
  label: string;
  items: string[];
}

function groupIcons(names: string[]): Grouped[] {
  const buckets = new Map<string, string[]>();
  for (const c of CATEGORIES) buckets.set(c.id, []);
  buckets.set("other", []);
  outer: for (const name of names) {
    for (const c of CATEGORIES) {
      if (c.patterns.some((rx) => rx.test(name))) {
        buckets.get(c.id)!.push(name);
        continue outer;
      }
    }
    buckets.get("other")!.push(name);
  }
  const out: Grouped[] = [];
  for (const c of CATEGORIES) {
    const items = buckets.get(c.id)!;
    if (items.length > 0) out.push({ id: c.id, label: c.label, items });
  }
  const other = buckets.get("other")!;
  if (other.length > 0) out.push({ id: "other", label: "Inne", items: other });
  return out;
}

interface Props {
  value?: string;
  onChange: (name: string | undefined) => void;
  className?: string;
  placeholder?: string;
}

export function LucideIconPicker({
  value,
  onChange,
  className,
  placeholder = "Wybierz ikonę",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");

  // Full icon list, computed lazily on first render (client-side, admin-only) so
  // the heavy whole-namespace scan never runs at module-init time (see getAllIconNames).
  const allNames = useMemo(() => getAllIconNames(), []);

  // Icons matching current search (or all if empty)
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allNames;
    return allNames.filter((n) => n.includes(q));
  }, [query, allNames]);

  // Grouped view of the searched set → gives per-category counts
  const groupedSearched: Grouped[] = useMemo(() => groupIcons(searched), [searched]);

  // What we actually render in the main pane
  const displayed = useMemo(() => {
    if (activeCat === "all") return searched;
    const g = groupedSearched.find((x) => x.id === activeCat);
    return g ? g.items : [];
  }, [activeCat, searched, groupedSearched]);

  const countBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groupedSearched) m.set(g.id, g.items.length);
    return m;
  }, [groupedSearched]);

  const current = value?.trim() || "";

  const sidebarCats: { id: string; label: string; icon: string }[] = useMemo(
    () => [
      { id: "all", label: "Wszystkie", icon: "layout-grid" },
      ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, icon: c.icon })),
      { id: "other", label: "Inne", icon: "more-horizontal" },
    ],
    [],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            "inline-flex items-center gap-2 h-7 px-2 rounded-md border border-border bg-background text-xs hover:bg-accent transition-colors min-w-0 " +
            (className ?? "")
          }
          aria-label="Wybierz ikonę Lucide"
        >
          {current ? (
            <DynamicIcon name={current} width={14} height={14} className="shrink-0" />
          ) : (
            <HelpCircle className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{current || placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[520px] p-0 overflow-hidden">
        <div className="flex h-[360px]">
          {/* Sidebar - categories */}
          <div className="w-40 shrink-0 border-r border-border bg-muted/30 flex flex-col">
            <div className="px-3 py-2 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Kategorie
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-1.5 space-y-0.5">
                {sidebarCats.map((c) => {
                  const total =
                    c.id === "all" ? searched.length : countBy.get(c.id) ?? 0;
                  const isActive = activeCat === c.id;
                  const disabled = total === 0 && c.id !== "all";
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setActiveCat(c.id)}
                      disabled={disabled}
                      className={
                        "w-full flex items-center gap-2 h-7 px-2 rounded-md text-[11px] font-medium transition-colors text-left " +
                        (isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : disabled
                            ? "text-muted-foreground/40 cursor-not-allowed"
                            : "text-foreground/80 hover:bg-accent hover:text-foreground")
                      }
                    >
                      <DynamicIcon
                        name={c.icon}
                        width={13}
                        height={13}
                        className="shrink-0"
                      />
                      <span className="truncate flex-1">{c.label}</span>
                      <span
                        className={
                          "text-[10px] tabular-nums " +
                          (isActive
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground/70")
                        }
                      >
                        {total}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Main pane - search + icon grid */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-1 p-2 border-b border-border">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Szukaj (np. rocket, users)"
                  className="h-8 text-xs pl-8"
                />
              </div>
              {current ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  aria-label="Wyczyść ikonę"
                  title="Wyczyść ikonę"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              ) : null}
            </div>
            <ScrollArea className="flex-1">
              {displayed.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-10">
                  Brak wyników
                </div>
              ) : (
                <div className="grid grid-cols-10 gap-1 p-2">
                  {displayed.map((name) => {
                    const active = name === current;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          onChange(name);
                          setOpen(false);
                        }}
                        className={
                          "flex items-center justify-center h-8 w-8 rounded-md border transition-colors " +
                          (active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-transparent hover:bg-accent text-foreground")
                        }
                        title={name}
                        aria-label={name}
                        style={{
                          contentVisibility: "auto",
                          containIntrinsicSize: "32px 32px",
                        }}
                      >
                        <DynamicIcon name={name} width={16} height={16} />
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground truncate bg-muted/20">
              {displayed.length} / {allNames.length} ikon
              {current ? ` · wybrano: ${current}` : ""}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
