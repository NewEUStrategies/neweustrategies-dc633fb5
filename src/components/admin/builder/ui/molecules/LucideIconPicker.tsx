// Molecule: Lucide icon picker.
// Popover with search input + virtualized-ish grid of Lucide icons.
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

// Build once: all PascalCase*Icon entries → kebab-case names.
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_ICON_NAMES;
    return ALL_ICON_NAMES.filter((n) => n.includes(q));
  }, [query]);

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
      <PopoverContent align="start" className="w-80 p-2">
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
        <ScrollArea className="h-64">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">
              Brak wyników
            </div>
          ) : (
            <div className="grid grid-cols-8 gap-1 pr-2">
              {filtered.map((name) => {
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
          )}
        </ScrollArea>
        <div className="mt-2 text-[10px] text-muted-foreground truncate">
          {filtered.length} / {ALL_ICON_NAMES.length} ikon
          {current ? ` - wybrano: ${current}` : ""}
        </div>
      </PopoverContent>
    </Popover>
  );
}
