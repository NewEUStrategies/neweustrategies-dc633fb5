// Organism: Section Tabs pane - manage tab list + assign children to tabs.
// When enabled, the Section acts as a tab container: only children whose
// tabId matches the active tab are rendered (children with empty tabId
// remain visible in every tab).
import { useEffect, useRef, useState } from "react";
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
import { Plus, Trash2, ArrowUp, ArrowDown, Check, X } from "lucide-react";
import type { SectionNode, SectionTabItem, SectionTabsConfig } from "@/lib/builder/types";
import { Row } from "../../atoms";
import { LucideIconPicker } from "../../molecules/LucideIconPicker";
import { ColorPicker } from "../../molecules/ColorPicker";
import { StepperButtons } from "../../atoms/StepperButtons";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

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
  const { t } = useTranslation();
  const tp = (k: string, o?: Record<string, unknown>) => t(`builder.tabsPane.${k}`, o);
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

  const MAX_TABS = 10;
  const addTab = () => {
    setCfg((c) => {
      if (c.items.length >= MAX_TABS) return;
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
      <Row label={tp("enable")} hint={tp("enableHint")}>
        <Switch checked={!!cfg.enabled} onCheckedChange={toggleEnabled} />
      </Row>

      {cfg.enabled && (
        <>
          <Row label={tp("orientation")}>
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
                <SelectItem value="horizontal">{tp("horizontal")}</SelectItem>
                <SelectItem value="vertical">{tp("vertical")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label={tp("variant")}>
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
                <SelectItem value="underline">{tp("vUnderline")}</SelectItem>
                <SelectItem value="underline-thick">{tp("vUnderlineThick")}</SelectItem>
                <SelectItem value="underline-dot">{tp("vUnderlineDot")}</SelectItem>
                <SelectItem value="underline-gradient">{tp("vUnderlineGradient")}</SelectItem>
                <SelectItem value="pills">{tp("vPills")}</SelectItem>
                <SelectItem value="pills-solid">{tp("vPillsSolid")}</SelectItem>
                <SelectItem value="segmented">Segmented control</SelectItem>
                <SelectItem value="boxed-top">{tp("vBoxedTop")}</SelectItem>
                <SelectItem value="bordered">{tp("vBordered")}</SelectItem>
                <SelectItem value="ghost">Ghost</SelectItem>
                <SelectItem value="minimal">{tp("vMinimal")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label={tp("accentColor")} hint={tp("accentColorHint")}>
            <ColorPicker
              value={cfg.accentColor}
              onChange={(v) =>
                setCfg((c) => {
                  c.accentColor = v;
                })
              }
              ariaLabel={tp("accentColor")}
              showInput
              placeholder={t("builder.colorPicker.placeholder")}
            />
          </Row>

          <Row label={tp("iconPosition")}>
            <Select
              value={cfg.iconPosition ?? "left"}
              onValueChange={(v) =>
                setCfg((c) => {
                  c.iconPosition = v as "left" | "top";
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">{tp("iconBeside")}</SelectItem>
                <SelectItem value="top">{tp("iconTop")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row label={tp("iconSize")}>
            <div className="relative">
              <Input
                type="number"
                min={10}
                max={32}
                className="h-8 text-xs pr-6"
                value={cfg.iconSize ?? 16}
                onChange={(e) =>
                  setCfg((c) => {
                    c.iconSize = Math.max(10, Math.min(32, Number(e.target.value) || 16));
                  })
                }
              />
              <StepperButtons
                onIncrement={() =>
                  setCfg((c) => {
                    c.iconSize = Math.min(32, (c.iconSize ?? 16) + 1);
                  })
                }
                onDecrement={() =>
                  setCfg((c) => {
                    c.iconSize = Math.max(10, (c.iconSize ?? 16) - 1);
                  })
                }
              />
            </div>
          </Row>

          <Row label={tp("fontSize")} hint={tp("fontSizeHint")}>
            <div className="relative">
              <Input
                type="number"
                min={8}
                max={48}
                className="h-8 text-xs pr-6"
                value={cfg.fontSize ?? 14}
                onChange={(e) =>
                  setCfg((c) => {
                    c.fontSize = Math.max(8, Math.min(48, Number(e.target.value) || 14));
                  })
                }
              />
              <StepperButtons
                onIncrement={() =>
                  setCfg((c) => {
                    c.fontSize = Math.min(48, (c.fontSize ?? 14) + 1);
                  })
                }
                onDecrement={() =>
                  setCfg((c) => {
                    c.fontSize = Math.max(8, (c.fontSize ?? 14) - 1);
                  })
                }
              />
            </div>
          </Row>

          <FontSizeLiveCheck sectionId={section.id} expectedPx={cfg.fontSize ?? 14} />

          <Row label={t("builder.spacing.align")}>
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
                <SelectItem value="start">{tp("alignLeft")}</SelectItem>
                <SelectItem value="center">{tp("alignCenter")}</SelectItem>
                <SelectItem value="end">{tp("alignRight")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          {(cfg.orientation ?? "horizontal") === "horizontal" && (
            <Row label="Mobile" hint={tp("mobileHint")}>
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
                  <SelectItem value="scroll">{tp("mobileScroll")}</SelectItem>
                  <SelectItem value="wrap">{tp("mobileWrap")}</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          )}

          <div className="space-y-2 pt-2 border-t border-border">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {tp("list")}
            </div>
            {items.map((t, i) => (
              <div
                key={t.id}
                className="rounded border border-border bg-background p-2 space-y-1.5"
              >
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground w-6">#{i + 1}</span>
                  <Input
                    className="h-7 text-xs"
                    placeholder={tp("labelPl")}
                    value={t.label_pl}
                    onChange={(e) => patchTab(t.id, { label_pl: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label={tp("moveUp")}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label={tp("moveDown")}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTab(t.id)}
                    disabled={items.length <= 1}
                    className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label={tp("removeTab")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Input
                  className="h-7 text-xs"
                  placeholder={tp("labelEn")}
                  value={t.label_en ?? ""}
                  onChange={(e) => patchTab(t.id, { label_en: e.target.value })}
                />
                <div className="flex items-center gap-1">
                  <LucideIconPicker
                    value={t.icon}
                    onChange={(name) => patchTab(t.id, { icon: name })}
                    className="flex-1"
                  />
                  <ColorPicker
                    value={t.color}
                    onChange={(v) => patchTab(t.id, { color: v })}
                    ariaLabel={tp("tabColor")}
                  />
                </div>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full h-8 text-xs"
              onClick={addTab}
              disabled={items.length >= MAX_TABS}
              title={items.length >= MAX_TABS ? tp("maxTabs", { max: MAX_TABS }) : undefined}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />{" "}
              {tp("addTab", { count: items.length, max: MAX_TABS })}
            </Button>
          </div>

          <Row label={tp("defaultTab")}>
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
              {tp("childAssign")}
            </div>
            {(section.children ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground italic">{tp("noColumns")}</p>
            )}
            {(section.children ?? []).map((c, i) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20 shrink-0">
                  {c.kind === "column"
                    ? tp("columnN", { n: i + 1 })
                    : tp("innerSecN", { n: i + 1 })}
                </span>
                <Select
                  value={c.tabId ?? ""}
                  onValueChange={(v) => assignChild(c.id, v === "__all__" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder={tp("pickTab")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{tp("visibleAll")}</SelectItem>
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

/**
 * Live self-check: mierzy rzeczywisty `font-size` etykiet renderowanego
 * `SectionTabsBar` dla tej sekcji i porównuje z wartością z konfiguracji.
 * Aktualizowany w czasie rzeczywistym via `MutationObserver` + `requestAnimationFrame`.
 * Renderuje etykietę i checkbox (read-only), zielony ✔ gdy wszystkie etykiety
 * mają dokładnie oczekiwany rozmiar, czerwony ✕ w przeciwnym razie.
 */
function FontSizeLiveCheck({ sectionId, expectedPx }: { sectionId: string; expectedPx: number }) {
  const { t } = useTranslation();
  const tp = (k: string, o?: Record<string, unknown>) => t(`builder.tabsPane.${k}`, o);
  const [state, setState] = useState<{
    ok: boolean;
    measured: number[];
    count: number;
  }>({ ok: false, measured: [], count: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const measure = () => {
      rafRef.current = null;
      const scope: ParentNode = document;
      // Match the bar rendered for this section (id used in aria wiring).
      const buttons = scope.querySelectorAll<HTMLElement>(
        `[id^="sec-${sectionId}-tab-"][data-section-tab-btn]`,
      );
      if (buttons.length === 0) {
        setState({ ok: false, measured: [], count: 0 });
        return;
      }
      const measured: number[] = [];
      buttons.forEach((btn) => {
        const px = parseFloat(window.getComputedStyle(btn).fontSize);
        measured.push(Math.round(px * 100) / 100);
      });
      const ok = measured.every((v) => Math.abs(v - expectedPx) < 0.5);
      setState({ ok, measured, count: buttons.length });
    };
    const schedule = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(measure);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "data-active"],
      childList: true,
    });
    return () => {
      mo.disconnect();
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [sectionId, expectedPx]);

  const { ok, measured, count } = state;
  const noBar = count === 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded border border-border bg-muted/30 p-2"
      data-testid="tabs-fontsize-live-check"
    >
      <input
        type="checkbox"
        readOnly
        checked={ok && !noBar}
        aria-label={tp("fontSyncAria")}
        className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
      />
      <div className="flex-1 space-y-0.5">
        <div className="flex items-center gap-1 text-[11px] font-medium">
          {noBar ? (
            <span className="text-muted-foreground">{tp("noTabsToMeasure")}</span>
          ) : ok ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" aria-hidden />
              <span className="text-emerald-600 dark:text-emerald-400">{tp("fontSyncOk")}</span>
            </>
          ) : (
            <>
              <X className="h-3 w-3 text-destructive" aria-hidden />
              <span className="text-destructive">{tp("fontNotSync")}</span>
            </>
          )}
        </div>
        {!noBar && (
          <div className="text-[10px] text-muted-foreground">
            {tp("measured", { expected: expectedPx, measured: measured.join(", "), count })}
          </div>
        )}
      </div>
    </div>
  );
}
