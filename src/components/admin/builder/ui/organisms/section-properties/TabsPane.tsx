// Organism: Section Tabs pane - manage tab list + assign children to tabs.
// When enabled, the Section acts as a tab container: only children whose
// tabId matches the active tab are rendered (children with empty tabId
// remain visible in every tab).
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { SectionNode, SectionTabItem, SectionTabsConfig } from "@/lib/builder/types";
import { Row } from "../../atoms";

type Mut = (mut: (s: SectionNode) => void) => void;

function makeTabId(): string {
  return `tab_${Math.random().toString(36).slice(2, 9)}`;
}

function ensureCfg(cfg: SectionTabsConfig | undefined): SectionTabsConfig {
  return (
    cfg ?? {
      enabled: false,
      items: [],
      orientation: "horizontal",
      variant: "underline",
      align: "start",
    }
  );
}

export function TabsPane({ section, onChange }: { section: SectionNode; onChange: Mut }) {
  const cfg = ensureCfg(section.tabs);
  const items = cfg.items ?? [];

  const setCfg = (mut: (c: SectionTabsConfig) => void) =>
    onChange((s) => {
      s.tabs = ensureCfg(s.tabs);
      mut(s.tabs);
    });

  const toggleEnabled = (v: boolean) =>
    onChange((s) => {
      const next = ensureCfg(s.tabs);
      next.enabled = v;
      // Seed with 2 tabs when first enabling.
      if (v && next.items.length === 0) {
        const a: SectionTabItem = { id: makeTabId(), label_pl: "Zakładka 1", label_en: "Tab 1" };
        const b: SectionTabItem = { id: makeTabId(), label_pl: "Zakładka 2", label_en: "Tab 2" };
        next.items = [a, b];
        next.defaultTabId = a.id;
        // Assign existing children to first tab so they don't stay
        // "visible in every tab" by accident.
        (s.children ?? []).forEach((c) => {
          if (c && !c.tabId) c.tabId = a.id;
        });
      }
      s.tabs = next;
    });

  const addTab = () => {
    setCfg((c) => {
      const idx = c.items.length + 1;
      c.items.push({
        id: makeTabId(),
        label_pl: `Zakładka ${idx}`,
        label_en: `Tab ${idx}`,
      });
    });
  };

  const removeTab = (id: string) => {
    onChange((s) => {
      s.tabs = ensureCfg(s.tabs);
      s.tabs.items = s.tabs.items.filter((t) => t.id !== id);
      if (s.tabs.defaultTabId === id) {
        s.tabs.defaultTabId = s.tabs.items[0]?.id;
      }
      // Reassign orphan children to the first remaining tab.
      const fallback = s.tabs.items[0]?.id;
      (s.children ?? []).forEach((c) => {
        if (c && c.tabId === id) c.tabId = fallback;
      });
    });
  };

  const move = (idx: number, dir: -1 | 1) => {
    setCfg((c) => {
      const j = idx + dir;
      if (j < 0 || j >= c.items.length) return;
      const tmp = c.items[idx];
      c.items[idx] = c.items[j];
      c.items[j] = tmp;
    });
  };

  const patchTab = (id: string, patch: Partial<SectionTabItem>) => {
    setCfg((c) => {
      const t = c.items.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
  };

  const assignChild = (childId: string, tabId: string) => {
    onChange((s) => {
      const c = (s.children ?? []).find((x) => x.id === childId);
      if (c) c.tabId = tabId || undefined;
    });
  };

  return (
    <div className="space-y-3">
      <Row
        label="Sekcja jako zakładki"
        hint="Włącz, aby ta sekcja stała się kontenerem zakładek. Dzieci (kolumny/inner-sections) będą renderowane tylko wewnątrz swojej zakładki."
      >
        <Switch checked={!!cfg.enabled} onCheckedChange={toggleEnabled} />
      </Row>

      {cfg.enabled && (
        <>
          <Row label="Orientacja">
            <Select
              value={cfg.orientation ?? "horizontal"}
              onValueChange={(v) =>
                setCfg((c) => {
                  c.orientation = v as "horizontal" | "vertical";
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="horizontal">Poziomo</SelectItem>
                <SelectItem value="vertical">Pionowo</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label="Wariant">
            <Select
              value={cfg.variant ?? "underline"}
              onValueChange={(v) =>
                setCfg((c) => {
                  c.variant = v as SectionTabsConfig["variant"];
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="underline">Podkreślenie</SelectItem>
                <SelectItem value="pills">Pigułki</SelectItem>
                <SelectItem value="bordered">Ramka</SelectItem>
                <SelectItem value="ghost">Ghost</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label="Wyrównanie">
            <Select
              value={cfg.align ?? "start"}
              onValueChange={(v) =>
                setCfg((c) => {
                  c.align = v as "start" | "center" | "end";
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start">Do lewej</SelectItem>
                <SelectItem value="center">Do środka</SelectItem>
                <SelectItem value="end">Do prawej</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          {(cfg.orientation ?? "horizontal") === "horizontal" && (
            <Row
              label="Mobile"
              hint="Zachowanie paska zakładek gdy etykiety nie mieszczą się w szerokości ekranu."
            >
              <Select
                value={cfg.mobileMode ?? "scroll"}
                onValueChange={(v) =>
                  setCfg((c) => {
                    c.mobileMode = v as "scroll" | "wrap";
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scroll">Przewijanie poziome</SelectItem>
                  <SelectItem value="wrap">Zawijanie do wielu linii</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          )}

          <div className="space-y-2 pt-2 border-t border-border">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Lista zakładek
            </div>
            {items.map((t, i) => (
              <div key={t.id} className="rounded border border-border bg-background p-2 space-y-1.5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground w-6">#{i + 1}</span>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Etykieta PL"
                    value={t.label_pl}
                    onChange={(e) => patchTab(t.id, { label_pl: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="W górę"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="W dół"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTab(t.id)}
                    disabled={items.length <= 1}
                    className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="Usuń zakładkę"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Input
                  className="h-7 text-xs"
                  placeholder="Etykieta EN"
                  value={t.label_en ?? ""}
                  onChange={(e) => patchTab(t.id, { label_en: e.target.value })}
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full h-8 text-xs"
              onClick={addTab}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Dodaj zakładkę
            </Button>
          </div>

          <Row label="Zakładka domyślna">
            <Select
              value={cfg.defaultTabId ?? items[0]?.id ?? ""}
              onValueChange={(v) =>
                setCfg((c) => {
                  c.defaultTabId = v;
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label_pl || t.label_en || t.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <div className="space-y-2 pt-2 border-t border-border">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Przypisanie dzieci
            </div>
            {(section.children ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                Sekcja nie ma jeszcze kolumn.
              </p>
            )}
            {(section.children ?? []).map((c, i) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20 shrink-0">
                  {c.kind === "column" ? `Kolumna ${i + 1}` : `Inner-sec ${i + 1}`}
                </span>
                <Select
                  value={c.tabId ?? ""}
                  onValueChange={(v) => assignChild(c.id, v === "__all__" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Wybierz zakładkę" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Widoczne w każdej</SelectItem>
                    {items.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label_pl || t.label_en || t.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
