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

const ALL_ICON_NAMES: string[] = (() => {
  const reg = LucideIcons as unknown as Record<string, unknown>;
  const set = new Set<string>();
  for (const key of Object.keys(reg)) {
    if (!key.endsWith("Icon")) continue;
    const val = reg[key];
    if (typeof val !== "function" && typeof val !== "object") continue;
    const kebab = pascalToKebab(key);
    if (kebab && /^[a-z0-9-]+$/.test(kebab)) set.add(kebab);
  }
  return Array.from(set).sort();
})();

// Category definitions - keyword patterns matched against icon names.
// Order matters: first matching category wins. Everything else falls to "other".
interface Category {
  id: string;
  label: string;
  patterns: RegExp[];
}

const CATEGORIES: Category[] = [
  {
    id: "arrows",
    label: "Strzałki",
    patterns: [/^arrow/, /^chevron/, /^move/, /^corner/, /^redo/, /^undo/, /^rotate/, /-arrow/],
  },
  {
    id: "layout",
    label: "Layout",
    patterns: [/^layout/, /^grid/, /^columns/, /^rows/, /^panel/, /^sidebar/, /^align/, /^table/, /^kanban/, /^dashboard/],
  },
  {
    id: "text",
    label: "Tekst",
    patterns: [/^type/, /^heading/, /^text/, /^bold/, /^italic/, /^underline/, /^strikethrough/, /^list/, /^quote/, /^pilcrow/, /^case/, /^font/, /^letter/, /^paragraph/, /^wrap-text/, /^indent/, /^subscript/, /^superscript/, /^whole-word/],
  },
  {
    id: "media",
    label: "Media",
    patterns: [/^camera/, /^image/, /^video/, /^film/, /^tv/, /^music/, /^audio/, /^headphones/, /^mic/, /^volume/, /^speaker/, /^play/, /^pause/, /^stop-circle/, /^skip/, /^rewind/, /^fast-forward/, /^radio/, /^cast/, /^disc/, /^podcast/, /^gallery/, /^clapperboard/, /^guitar/, /^piano/, /^drum/, /^theater/],
  },
  {
    id: "files",
    label: "Pliki",
    patterns: [/^file/, /^folder/, /^archive/, /^clipboard/, /^paperclip/, /^book/, /^library/, /^notebook/, /^scroll/, /^sticky-note/, /^bookmark/, /^newspaper/, /^receipt/],
  },
  {
    id: "communication",
    label: "Komunikacja",
    patterns: [/^mail/, /^message/, /^send/, /^inbox/, /^bell/, /^at-sign/, /^phone/, /^voicemail/, /^rss/, /^megaphone/, /^speech/, /^reply/, /^forward/, /^signal/],
  },
  {
    id: "users",
    label: "Ludzie",
    patterns: [/^user/, /^users/, /^person/, /^contact/, /^baby/, /^accessibility/, /^footprints/, /^hand/, /^ear/, /^smile/, /^laugh/, /^frown/, /^angry/, /^annoyed/, /^meh/, /^venetian-mask/, /^drama/, /^persistent-avatar/, /^cat/, /^dog/, /^bird/, /^fish/, /^rabbit/, /^turtle/, /^squirrel/, /^snail/, /^bug/, /^worm/, /^rat/, /^origami/],
  },
  {
    id: "shopping",
    label: "Zakupy",
    patterns: [/^shopping/, /^cart/, /^store/, /^shop/, /^gift/, /^tag/, /^ticket/, /^package/, /^shirt/, /^wallet/, /^credit-card/, /^coins/, /^banknote/, /^piggy/, /^dollar/, /^euro/, /^pound/, /^yen/, /^bitcoin/, /^currency/, /^receipt/, /^percent/, /^badge/, /^scan/],
  },
  {
    id: "devices",
    label: "Urządzenia",
    patterns: [/^laptop/, /^computer/, /^monitor/, /^smartphone/, /^tablet/, /^watch/, /^printer/, /^scanner/, /^mouse/, /^keyboard/, /^gamepad/, /^joystick/, /^webcam/, /^usb/, /^hard-drive/, /^cpu/, /^memory-stick/, /^floppy/, /^server/, /^router/, /^plug/, /^power/, /^battery/, /^cable/, /^ethernet/, /^bluetooth/, /^wifi/, /^rss/, /^cast/, /^screen/, /^smart/, /^remote/],
  },
  {
    id: "nature",
    label: "Natura",
    patterns: [/^tree/, /^leaf/, /^flower/, /^cherry/, /^flame/, /^cloud/, /^sun/, /^moon/, /^star/, /^snow/, /^rain/, /^droplet/, /^droplets/, /^wind/, /^waves/, /^mountain/, /^globe/, /^earth/, /^planet/, /^milestone/, /^sprout/, /^leafy/, /^cactus/, /^palm/, /^grape/, /^apple/, /^banana/, /^carrot/, /^orange/, /^lemon/, /^egg/, /^wheat/, /^clover/, /^shell/, /^feather/, /^bone/, /^paw-print/, /^umbrella/, /^rainbow/, /^tornado/, /^haze/, /^fog/],
  },
  {
    id: "tools",
    label: "Narzędzia",
    patterns: [/^wrench/, /^hammer/, /^screwdriver/, /^drill/, /^saw/, /^ruler/, /^pencil/, /^pen/, /^brush/, /^paintbrush/, /^paint/, /^palette/, /^eraser/, /^pipette/, /^scissors/, /^knife/, /^axe/, /^magnet/, /^wand/, /^cog/, /^settings/, /^sliders/, /^toggle/, /^bolt/, /^plug/, /^stethoscope/, /^syringe/, /^microscope/, /^telescope/, /^binoculars/, /^compass/, /^flashlight/, /^lamp/],
  },
  {
    id: "shapes",
    label: "Kształty",
    patterns: [/^square/, /^circle/, /^triangle/, /^hexagon/, /^octagon/, /^pentagon/, /^diamond/, /^shapes/, /^spline/, /^ligature/, /^box/, /^cylinder/, /^cone/, /^torus/, /^sphere/, /^ampersand/, /^asterisk/, /^slash/],
  },
  {
    id: "map",
    label: "Mapy",
    patterns: [/^map/, /^pin/, /^locate/, /^navigation/, /^compass/, /^route/, /^milestone/, /^flag/, /^building/, /^house/, /^home/, /^landmark/, /^castle/, /^church/, /^hotel/, /^school/, /^warehouse/, /^factory/, /^office/, /^tent/, /^waypoints/],
  },
  {
    id: "transport",
    label: "Transport",
    patterns: [/^car/, /^bus/, /^truck/, /^bike/, /^bicycle/, /^scooter/, /^plane/, /^ship/, /^sailboat/, /^rocket/, /^fuel/, /^parking/, /^train/, /^tram/, /^caravan/, /^ambulance/, /^taxi/, /^helicopter/, /^anchor/, /^gauge/, /^footprints/, /^traffic/],
  },
  {
    id: "food",
    label: "Jedzenie",
    patterns: [/^coffee/, /^cup/, /^wine/, /^beer/, /^martini/, /^milk/, /^candy/, /^cake/, /^cookie/, /^pizza/, /^sandwich/, /^salad/, /^soup/, /^egg/, /^ice-cream/, /^dessert/, /^popcorn/, /^utensils/, /^chef/, /^ham/, /^beef/, /^drumstick/, /^croissant/, /^donut/, /^pretzel/, /^lollipop/, /^bean/],
  },
  {
    id: "sport",
    label: "Sport",
    patterns: [/^dumbbell/, /^trophy/, /^medal/, /^award/, /^target/, /^flag/, /^gamepad/, /^tent/, /^backpack/, /^bike/, /^ski/, /^snowflake/, /^volleyball/, /^football/, /^basketball/, /^tennis/, /^golf/, /^goal/, /^whistle/, /^stopwatch/, /^timer/],
  },
  {
    id: "security",
    label: "Bezpieczeństwo",
    patterns: [/^lock/, /^unlock/, /^key/, /^shield/, /^scan/, /^fingerprint/, /^eye/, /^eye-off/, /^radar/, /^bug/, /^alert/, /^ban/],
  },
  {
    id: "charts",
    label: "Wykresy",
    patterns: [/^chart/, /^bar-chart/, /^line-chart/, /^pie-chart/, /^area-chart/, /^scatter/, /^radar/, /^trending/, /^activity/, /^gauge/, /^sigma/, /^calculator/, /^binary/, /^percent/],
  },
  {
    id: "time",
    label: "Czas",
    patterns: [/^clock/, /^watch/, /^timer/, /^stopwatch/, /^calendar/, /^hourglass/, /^alarm/, /^history/],
  },
  {
    id: "weather",
    label: "Pogoda",
    patterns: [/^sun/, /^moon/, /^cloud/, /^rain/, /^snow/, /^thermometer/, /^umbrella/, /^wind/, /^tornado/, /^haze/, /^fog/, /^rainbow/, /^cloudy/, /^drizzle/, /^lightning/, /^droplet/],
  },
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

const GROUPED_ALL: Grouped[] = groupIcons(ALL_ICON_NAMES);

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

  const groups: Grouped[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const matches = ALL_ICON_NAMES.filter((n) => n.includes(q));
      return groupIcons(matches);
    }
    if (activeCat === "all") return GROUPED_ALL;
    return GROUPED_ALL.filter((g) => g.id === activeCat);
  }, [query, activeCat]);

  const totalShown = useMemo(
    () => groups.reduce((sum, g) => sum + g.items.length, 0),
    [groups],
  );

  const current = value?.trim() || "";

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
      <PopoverContent align="start" className="w-96 p-2">
        <div className="flex items-center gap-1 mb-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj (np. rocket, users)"
              className="h-8 text-xs pl-7"
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

        {!query.trim() ? (
          <div className="flex flex-wrap gap-1 mb-2">
            <CatChip
              active={activeCat === "all"}
              onClick={() => setActiveCat("all")}
              label="Wszystkie"
              count={ALL_ICON_NAMES.length}
            />
            {GROUPED_ALL.map((g) => (
              <CatChip
                key={g.id}
                active={activeCat === g.id}
                onClick={() => setActiveCat(g.id)}
                label={g.label}
                count={g.items.length}
              />
            ))}
          </div>
        ) : null}

        <ScrollArea className="h-64">
          {totalShown === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">
              Brak wyników
            </div>
          ) : (
            <div className="space-y-3 pr-2">
              {groups.map((g) => (
                <div key={g.id}>
                  <div className="sticky top-0 z-10 bg-popover/95 backdrop-blur-sm text-[10px] uppercase tracking-wide font-semibold text-muted-foreground px-1 py-1 mb-1">
                    {g.label}{" "}
                    <span className="text-muted-foreground/60 font-normal normal-case">
                      ({g.items.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-10 gap-1">
                    {g.items.map((name) => {
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
                          style={{ contentVisibility: "auto", containIntrinsicSize: "32px 32px" }}
                        >
                          <DynamicIcon name={name} width={16} height={16} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="mt-2 text-[10px] text-muted-foreground truncate">
          {totalShown} / {ALL_ICON_NAMES.length} ikon
          {current ? ` - wybrano: ${current}` : ""}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CatChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-medium border transition-colors " +
        (active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-foreground")
      }
    >
      {label}
      <span className={active ? "opacity-80" : "opacity-60"}>{count}</span>
    </button>
  );
}
