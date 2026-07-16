// Menedżer menu w stylu WordPress: drag & drop drzewo (3 poziomy),
// inline edytor każdej pozycji + toggle mega-panelu, zapis atomowy.
// Ekran: /admin/appearance/menu.
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, GripVertical, Save, Trash2, Loader2, ArrowLeft, ArrowRight, Link as LinkIcon } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { saveMenu as saveMenuFn } from "@/lib/menus/menu.functions";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
import { AddItemPanel } from "./AddItemPanel";
import { MegaPanelView } from "@/components/menu/MegaPanelView";
import { LucideIconPicker } from "@/components/admin/builder/ui/molecules/LucideIconPicker";
import { megaFeaturedPostQueryOptions, type MegaFeaturedPost } from "@/lib/menus/megaFeatured";

import {
  DEFAULT_MEGA_CONFIG,
  type MenuItemInput,
  type MenuItemType,
  type MegaConfig,
} from "@/lib/menus/types";

interface Props {
  menuKey: string;
}

// Praca w klientowym modelu: każdy item ma stabilne `local_id`,
// hierarchia przez `parent_local_id`.
interface ClientItem {
  local_id: string;
  parent_local_id: string | null;
  position: number;
  item_type: MenuItemType;
  ref_id: string | null;
  label_pl: string;
  label_en: string;
  href: string;
  target: "_self" | "_blank";
  css_class: string;
  mega_enabled: boolean;
  mega_config: MegaConfig;
}

const DND_MIME = "application/x-menu-item";
const MAX_DEPTH = 3;

const rid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export function MenuManager({ menuKey }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const menuQuery = useQuery(menuWithItemsQueryOptions(menuKey));
  const [items, setItems] = useState<ClientItem[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Zainicjalizuj stan lokalny gdy dane dotrą.
  const initFromServer = useCallback(() => {
    if (!menuQuery.data) return;
    const serverItems = menuQuery.data.items;
    const idToLocal = new Map<string, string>();
    for (const it of serverItems) idToLocal.set(it.id, rid());
    const mapped: ClientItem[] = serverItems.map((it) => ({
      local_id: idToLocal.get(it.id)!,
      parent_local_id: it.parent_id ? (idToLocal.get(it.parent_id) ?? null) : null,
      position: it.position,
      item_type: it.item_type,
      ref_id: it.ref_id,
      label_pl: it.label_pl,
      label_en: it.label_en,
      href: it.href,
      target: (it.target === "_blank" ? "_blank" : "_self") as "_self" | "_blank",
      css_class: it.css_class,
      mega_enabled: it.mega_enabled,
      mega_config: it.mega_config,
    }));
    setItems(mapped);
  }, [menuQuery.data]);

  // Auto-init po pierwszym fetchu.
  if (items === null && menuQuery.data && !menuQuery.isFetching) {
    initFromServer();
  }

  const saveServer = useServerFn(saveMenuFn);
  const saveMutation = useMutation({
    mutationFn: async (payload: MenuItemInput[]) =>
      saveServer({ data: { menu_key: menuKey, items: payload } }),
    onSuccess: async () => {
      toast.success(t("admin.menu.saved", { defaultValue: "Menu zapisane" }));
      await qc.invalidateQueries({ queryKey: ["menu-with-items", menuKey] });
      await qc.invalidateQueries({ queryKey: ["public-menu", menuKey] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("admin.menu.saveError", { defaultValue: "Nie udało się zapisać menu" }) + `: ${msg}`);
    },
  });

  const tree = useMemo(() => buildTree(items ?? []), [items]);

  const updateItem = (local_id: string, patch: Partial<ClientItem>) => {
    setItems((curr) => (curr ?? []).map((it) => (it.local_id === local_id ? { ...it, ...patch } : it)));
  };

  const removeItem = (local_id: string) => {
    setItems((curr) => {
      if (!curr) return curr;
      const idsToRemove = new Set<string>();
      const collect = (id: string) => {
        idsToRemove.add(id);
        for (const child of curr.filter((c) => c.parent_local_id === id)) collect(child.local_id);
      };
      collect(local_id);
      return curr.filter((it) => !idsToRemove.has(it.local_id));
    });
  };

  const addItems = (
    payloads: {
      item_type: MenuItemType;
      ref_id: string | null;
      label_pl: string;
      label_en: string;
      href: string;
    }[],
  ) => {
    setItems((curr) => {
      const base = curr ?? [];
      const nextPos = base.filter((i) => i.parent_local_id === null).length;
      const additions: ClientItem[] = payloads.map((p, idx) => ({
        local_id: rid(),
        parent_local_id: null,
        position: nextPos + idx,
        item_type: p.item_type,
        ref_id: p.ref_id,
        label_pl: p.label_pl,
        label_en: p.label_en,
        href: p.href,
        target: "_self",
        css_class: "",
        mega_enabled: false,
        mega_config: DEFAULT_MEGA_CONFIG,
      }));
      return [...base, ...additions];
    });
  };

  const moveItem = (dragId: string, targetId: string | null, mode: "before" | "after" | "child") => {
    setItems((curr) => {
      if (!curr) return curr;
      const dragged = curr.find((i) => i.local_id === dragId);
      if (!dragged) return curr;
      // Chroń przed cyklem - target nie może być potomkiem dragged.
      if (targetId) {
        const descendants = new Set<string>();
        const collect = (id: string) => {
          descendants.add(id);
          for (const child of curr.filter((c) => c.parent_local_id === id)) collect(child.local_id);
        };
        collect(dragId);
        if (descendants.has(targetId)) return curr;
      }
      let newParent: string | null = dragged.parent_local_id;
      if (targetId === null) {
        newParent = null;
      } else if (mode === "child") {
        newParent = targetId;
      } else {
        const target = curr.find((i) => i.local_id === targetId);
        newParent = target?.parent_local_id ?? null;
      }
      // Ogranicz głębokość.
      if (newParent && depthOf(curr, newParent) + 1 >= MAX_DEPTH) return curr;

      const others = curr.filter((i) => i.local_id !== dragId);
      const siblings = others.filter((i) => i.parent_local_id === newParent);
      const remaining = others.filter((i) => i.parent_local_id !== newParent);
      let insertIndex = siblings.length;
      if (targetId && mode !== "child") {
        const targetIdx = siblings.findIndex((s) => s.local_id === targetId);
        if (targetIdx >= 0) insertIndex = mode === "before" ? targetIdx : targetIdx + 1;
      }
      const updated: ClientItem = { ...dragged, parent_local_id: newParent };
      const reordered = [...siblings.slice(0, insertIndex), updated, ...siblings.slice(insertIndex)].map(
        (it, idx) => ({ ...it, position: idx }),
      );
      return [...remaining, ...reordered];
    });
  };

  // Podpięcie w prawo: element staje się dzieckiem swojego poprzedniego rodzeństwa.
  const indentItem = (local_id: string) => {
    setItems((curr) => {
      if (!curr) return curr;
      const it = curr.find((i) => i.local_id === local_id);
      if (!it) return curr;
      const siblings = curr
        .filter((i) => i.parent_local_id === it.parent_local_id)
        .sort((a, b) => a.position - b.position);
      const idx = siblings.findIndex((s) => s.local_id === local_id);
      if (idx <= 0) return curr; // brak poprzedniego rodzeństwa
      const newParent = siblings[idx - 1].local_id;
      if (depthOf(curr, newParent) + 1 >= MAX_DEPTH) return curr;

      const newParentChildren = curr
        .filter((i) => i.parent_local_id === newParent)
        .sort((a, b) => a.position - b.position);
      const insertPos = newParentChildren.length;

      const updatedItem: ClientItem = { ...it, parent_local_id: newParent, position: insertPos };
      const remainingSiblings = siblings
        .filter((s) => s.local_id !== local_id)
        .map((s, i) => ({ ...s, position: i }));
      const others = curr.filter(
        (i) =>
          i.parent_local_id !== it.parent_local_id &&
          i.parent_local_id !== newParent &&
          i.local_id !== local_id,
      );
      return [...others, ...remainingSiblings, ...newParentChildren, updatedItem];
    });
    setExpanded((s) => {
      const it = (items ?? []).find((i) => i.local_id === local_id);
      if (!it) return s;
      const siblings = (items ?? [])
        .filter((i) => i.parent_local_id === it.parent_local_id)
        .sort((a, b) => a.position - b.position);
      const idx = siblings.findIndex((sib) => sib.local_id === local_id);
      if (idx <= 0) return s;
      const n = new Set(s);
      n.add(siblings[idx - 1].local_id);
      return n;
    });
  };

  // Cofnięcie w lewo: element wychodzi poziom wyżej, tuż za swoim rodzicem.
  const outdentItem = (local_id: string) => {
    setItems((curr) => {
      if (!curr) return curr;
      const it = curr.find((i) => i.local_id === local_id);
      if (!it || !it.parent_local_id) return curr;
      const parent = curr.find((i) => i.local_id === it.parent_local_id);
      if (!parent) return curr;
      const grandParent = parent.parent_local_id;

      const grandSiblings = curr
        .filter((i) => i.parent_local_id === grandParent)
        .sort((a, b) => a.position - b.position);
      const parentIdx = grandSiblings.findIndex((s) => s.local_id === parent.local_id);
      const insertAt = parentIdx + 1;

      const oldSiblings = curr
        .filter((i) => i.parent_local_id === it.parent_local_id && i.local_id !== local_id)
        .sort((a, b) => a.position - b.position)
        .map((s, i) => ({ ...s, position: i }));

      const updatedItem: ClientItem = { ...it, parent_local_id: grandParent };
      const reorderedGrand = [
        ...grandSiblings.slice(0, insertAt),
        updatedItem,
        ...grandSiblings.slice(insertAt),
      ].map((s, i) => ({ ...s, position: i }));

      const others = curr.filter(
        (i) =>
          i.parent_local_id !== it.parent_local_id &&
          i.parent_local_id !== grandParent &&
          i.local_id !== local_id,
      );
      return [...others, ...oldSiblings, ...reorderedGrand];
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const handleSave = () => {
    if (!items) return;
    const payload: MenuItemInput[] = items.map((it) => ({
      local_id: it.local_id,
      parent_local_id: it.parent_local_id,
      position: it.position,
      item_type: it.item_type,
      ref_id: it.ref_id,
      label_pl: it.label_pl || it.href || "(bez nazwy)",
      label_en: it.label_en,
      href: it.href,
      target: it.target,
      css_class: it.css_class,
      mega_enabled: it.mega_enabled,
      mega_config: it.mega_config,
    }));
    saveMutation.mutate(payload);
  };

  if (menuQuery.isLoading || items === null) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {t("common.loading", { defaultValue: "Wczytywanie..." })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-6">
      <aside className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("admin.menu.addItem", { defaultValue: "Dodaj element menu" })}
        </h2>
        <AddItemPanel onAdd={addItems} />
      </aside>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {t("admin.menu.structure", { defaultValue: "Struktura menu" })} · {menuKey}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("admin.menu.dragHint", {
                defaultValue: "Przeciągnij elementy, aby zmienić kolejność i hierarchię (max 3 poziomy).",
              })}
            </p>
          </div>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            {t("common.save", { defaultValue: "Zapisz" })}
          </Button>
        </div>

        <div
          className="space-y-1 border border-border rounded-lg bg-card p-3 min-h-[200px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const dragId = e.dataTransfer.getData(DND_MIME);
            if (dragId) moveItem(dragId, null, "after");
          }}
        >
          {tree.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              {t("admin.menu.emptyMenu", {
                defaultValue: "Brak elementów. Dodaj strony, wpisy, kategorie lub własne odnośniki z panelu po lewej.",
              })}
            </p>
          )}
          {tree.map((node, i) => (
            <MenuNode
              key={node.item.local_id}
              node={node}
              depth={0}
              siblingIndex={i}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              onUpdate={updateItem}
              onRemove={removeItem}
              onMove={moveItem}
              onIndent={indentItem}
              onOutdent={outdentItem}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface TreeNode {
  item: ClientItem;
  children: TreeNode[];
}

function buildTree(items: ClientItem[]): TreeNode[] {
  const byParent = new Map<string | null, ClientItem[]>();
  for (const it of items) {
    const key = it.parent_local_id;
    const arr = byParent.get(key) ?? [];
    arr.push(it);
    byParent.set(key, arr);
  }
  const build = (parent: string | null): TreeNode[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ item, children: build(item.local_id) }));
  return build(null);
}

function depthOf(items: ClientItem[], local_id: string): number {
  let d = 0;
  let cur: ClientItem | undefined = items.find((i) => i.local_id === local_id);
  while (cur?.parent_local_id) {
    d++;
    cur = items.find((i) => i.local_id === cur!.parent_local_id);
    if (d > 10) break;
  }
  return d;
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  siblingIndex: number;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onUpdate: (id: string, patch: Partial<ClientItem>) => void;
  onRemove: (id: string) => void;
  onMove: (dragId: string, targetId: string | null, mode: "before" | "after" | "child") => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
}

function MenuNode({ node, depth, siblingIndex, expanded, onToggleExpanded, onUpdate, onRemove, onMove, onIndent, onOutdent }: NodeProps) {
  const { t } = useTranslation();
  const { item, children } = node;
  const isOpen = expanded.has(item.local_id);
  const hasChildren = children.length > 0;
  const [dropZone, setDropZone] = useState<"before" | "after" | "child" | null>(null);

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_MIME, item.local_id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.3) setDropZone("before");
    else if (y > h * 0.7) setDropZone("after");
    else setDropZone(depth + 1 < MAX_DEPTH ? "child" : "after");
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dragId = e.dataTransfer.getData(DND_MIME);
    if (dragId && dragId !== item.local_id && dropZone) {
      onMove(dragId, item.local_id, dropZone);
    }
    setDropZone(null);
  };

  const typeLabel =
    item.item_type === "page"
      ? t("admin.menu.typePage", { defaultValue: "Strona" })
      : item.item_type === "post"
        ? t("admin.menu.typePost", { defaultValue: "Wpis" })
        : item.item_type === "category"
          ? t("admin.menu.typeCategory", { defaultValue: "Kategoria" })
          : item.item_type === "tag"
            ? t("admin.menu.typeTag", { defaultValue: "Tag" })
            : t("admin.menu.typeCustom", { defaultValue: "Własny" });

  return (
    <div className="relative">
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => setDropZone(null)}
        onDrop={onDrop}
        className={
          "border border-border rounded-md bg-background transition " +
          (dropZone === "before" ? "border-t-2 border-t-primary " : "") +
          (dropZone === "after" ? "border-b-2 border-b-primary " : "") +
          (dropZone === "child" ? "ring-2 ring-primary/50 " : "")
        }
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-move">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <button
            type="button"
            onClick={() => onToggleExpanded(item.local_id)}
            className="p-0.5 hover:bg-muted rounded shrink-0"
            aria-label={isOpen ? "Zwiń" : "Rozwiń"}
          >
            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-xs font-medium truncate">{item.label_pl || "(bez nazwy)"}</span>
            {depth > 0 && (
              <span className="text-[10px] italic text-muted-foreground shrink-0">
                {depth === 1
                  ? t("admin.menu.childItem", { defaultValue: "element podrzędny" })
                  : t("admin.menu.grandchildItem", { defaultValue: "element podrzędny 2. poziomu" })}
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wide shrink-0">
              {typeLabel}
            </span>
            {item.mega_enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                Mega
              </span>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => onOutdent(item.local_id)}
            disabled={depth === 0}
            aria-label={t("admin.menu.outdent", { defaultValue: "Cofnij w lewo" })}
            title={t("admin.menu.outdent", { defaultValue: "Cofnij w lewo (poziom wyżej)" })}
          >
            <ArrowLeft className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => onIndent(item.local_id)}
            disabled={siblingIndex === 0 || depth + 1 >= MAX_DEPTH}
            aria-label={t("admin.menu.indent", { defaultValue: "Podepnij w prawo" })}
            title={t("admin.menu.indent", { defaultValue: "Podepnij w prawo (jako podstrona)" })}
          >
            <ArrowRight className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-destructive"
            onClick={() => onRemove(item.local_id)}
            aria-label={t("common.delete", { defaultValue: "Usuń" })}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        {isOpen && (
          <div className="border-t border-border p-3 space-y-2 bg-muted/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Field label={t("admin.menu.labelPl", { defaultValue: "Etykieta (PL)" })}>
                <Input
                  value={item.label_pl}
                  onChange={(e) => onUpdate(item.local_id, { label_pl: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              <Field label={t("admin.menu.labelEn", { defaultValue: "Etykieta (EN)" })}>
                <Input
                  value={item.label_en}
                  onChange={(e) => onUpdate(item.local_id, { label_en: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              <Field label="URL">
                <Input
                  value={item.href}
                  onChange={(e) => onUpdate(item.local_id, { href: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              <Field label={t("admin.menu.target", { defaultValue: "Cel" })}>
                <Select
                  value={item.target}
                  onValueChange={(v) =>
                    onUpdate(item.local_id, { target: v === "_blank" ? "_blank" : "_self" })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_self">
                      {t("admin.menu.targetSelf", { defaultValue: "To samo okno" })}
                    </SelectItem>
                    <SelectItem value="_blank">
                      {t("admin.menu.targetBlank", { defaultValue: "Nowa karta" })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("admin.menu.cssClass", { defaultValue: "Klasa CSS" })}>
                <Input
                  value={item.css_class}
                  onChange={(e) => onUpdate(item.local_id, { css_class: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              {depth === 0 && (
                <Field label={t("admin.menu.megaToggle", { defaultValue: "Mega panel" })}>
                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      checked={item.mega_enabled}
                      onCheckedChange={(v) => onUpdate(item.local_id, { mega_enabled: v })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {item.mega_enabled
                        ? t("admin.menu.megaOn", { defaultValue: "Włączony" })
                        : t("admin.menu.megaOff", { defaultValue: "Wyłączony" })}
                    </span>
                  </div>
                </Field>
              )}
            </div>
            {depth === 0 && item.mega_enabled && (
              <MegaColumnsEditor
                config={item.mega_config}
                triggerPl={item.label_pl}
                triggerEn={item.label_en}
                onChange={(cfg) => onUpdate(item.local_id, { mega_config: cfg })}
              />
            )}
          </div>
        )}
      </div>

      {hasChildren && (
        <div className="ml-8 mt-1 space-y-1 border-l-2 border-border/60 pl-3 relative">
          {children.map((child, i) => (
            <MenuNode
              key={child.item.local_id}
              node={child}
              depth={depth + 1}
              siblingIndex={i}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMove={onMove}
              onIndent={onIndent}
              onOutdent={onOutdent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function MegaColumnsEditor({
  config,
  onChange,
  triggerPl,
  triggerEn,
}: {
  config: MegaConfig;
  onChange: (cfg: MegaConfig) => void;
  triggerPl: string;
  triggerEn: string;
}) {
  const { t } = useTranslation();
  const [previewLang, setPreviewLang] = useState<"pl" | "en">("pl");
  const addColumn = () =>
    onChange({
      ...config,
      columns: [...config.columns, { title_pl: "", title_en: "", href: "", links: [] }],
    });
  const updateColumn = (idx: number, patch: Partial<MegaConfig["columns"][number]>) =>
    onChange({
      ...config,
      columns: config.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    });
  const removeColumn = (idx: number) =>
    onChange({ ...config, columns: config.columns.filter((_, i) => i !== idx) });

  return (
    <div className="border border-border rounded-md p-3 space-y-2 bg-background">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">
          {t("admin.menu.megaColumns", { defaultValue: "Kolumny mega-panelu" })}
        </span>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-muted-foreground">Kolumn/rząd</label>
          <Select
            value={String(config.columns_per_row)}
            onValueChange={(v) => onChange({ ...config, columns_per_row: Number(v) })}
          >
            <SelectTrigger className="h-7 text-xs w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={config.width} onValueChange={(v) => onChange({ ...config, width: v as "container" | "full" })}>
            <SelectTrigger className="h-7 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="container">Container</SelectItem>
              <SelectItem value="full">Pełna szerokość</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        {config.columns.map((col, idx) => (
          <div key={idx} className="border border-border/60 rounded p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <Input
                value={col.title_pl}
                onChange={(e) => updateColumn(idx, { title_pl: e.target.value })}
                placeholder="Tytuł PL"
                className="h-7 text-xs"
              />
              <Input
                value={col.title_en}
                onChange={(e) => updateColumn(idx, { title_en: e.target.value })}
                placeholder="Tytuł EN"
                className="h-7 text-xs"
              />
              <Input
                value={col.href}
                onChange={(e) => updateColumn(idx, { href: e.target.value })}
                placeholder="href kolumny (opcjonalnie)"
                className="h-7 text-xs"
              />
              <InternalContentPicker
                onPick={(p) =>
                  updateColumn(idx, {
                    title_pl: col.title_pl || p.label_pl,
                    title_en: col.title_en || p.label_en,
                    href: p.href,
                  })
                }
                title="Powiąż nagłówek kolumny z treścią"
              />
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeColumn(idx)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <div className="pl-2 space-y-1">
              {col.links.map((l, li) => (
                <div key={li} className="flex items-center gap-1">
                  <LucideIconPicker
                    value={l.icon}
                    onChange={(name) =>
                      updateColumn(idx, {
                        links: col.links.map((x, i) =>
                          i === li ? { ...x, icon: name ?? "" } : x,
                        ),
                      })
                    }
                    className="h-7"
                    placeholder="Ikona"
                  />
                  <Input
                    value={l.label_pl}
                    onChange={(e) =>
                      updateColumn(idx, {
                        links: col.links.map((x, i) => (i === li ? { ...x, label_pl: e.target.value } : x)),
                      })
                    }
                    placeholder="Etykieta PL"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={l.label_en}
                    onChange={(e) =>
                      updateColumn(idx, {
                        links: col.links.map((x, i) => (i === li ? { ...x, label_en: e.target.value } : x)),
                      })
                    }
                    placeholder="EN"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={l.href}
                    onChange={(e) =>
                      updateColumn(idx, {
                        links: col.links.map((x, i) => (i === li ? { ...x, href: e.target.value } : x)),
                      })
                    }
                    placeholder="href"
                    className="h-7 text-xs"
                  />
                  <InternalContentPicker
                    onPick={(p) =>
                      updateColumn(idx, {
                        links: col.links.map((x, i) =>
                          i === li
                            ? {
                                ...x,
                                label_pl: x.label_pl || p.label_pl,
                                label_en: x.label_en || p.label_en,
                                href: p.href,
                              }
                            : x,
                        ),
                      })
                    }
                    title="Powiąż link z treścią wewnętrzną"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    onClick={() =>
                      updateColumn(idx, { links: col.links.filter((_, i) => i !== li) })
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() =>
                    updateColumn(idx, {
                      links: [...col.links, { label_pl: "", label_en: "", href: "", icon: "" }],
                    })
                  }
                >
                  + Własny link
                </Button>
                <InternalContentPicker
                  onPick={(p) =>
                    updateColumn(idx, {
                      links: [
                        ...col.links,
                        { label_pl: p.label_pl, label_en: p.label_en, href: p.href, icon: "" },
                      ],
                    })
                  }
                  title="Dodaj link z wewnętrznej treści"
                  variant="button"
                />
              </div>
            </div>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={addColumn}>
          + {t("admin.menu.addColumn", { defaultValue: "Dodaj kolumnę" })}
        </Button>
      </div>
      <FeaturedPostPicker
        value={config.featured_post_id}
        onChange={(id) => onChange({ ...config, featured_post_id: id })}
      />
      <MegaPreview
        config={config}
        triggerPl={triggerPl}
        triggerEn={triggerEn}
        lang={previewLang}
        onLangChange={setPreviewLang}
      />
    </div>
  );
}

// Podgląd na żywo mega-menu w panelu admina - renderuje ten sam komponent
// `MegaPanelView` co front, żeby admin widział 1:1 to, co użytkownik.
function MegaPreview({
  config,
  triggerPl,
  triggerEn,
  lang,
  onLangChange,
}: {
  config: MegaConfig;
  triggerPl: string;
  triggerEn: string;
  lang: "pl" | "en";
  onLangChange: (l: "pl" | "en") => void;
}) {
  const { t } = useTranslation();
  const featuredQuery = useQuery(megaFeaturedPostQueryOptions(config.featured_post_id ?? null));
  const featured = featuredQuery.data ?? null;

  const cols = useMemo(
    () =>
      config.columns.map((c) => ({
        title_pl: c.title_pl,
        title_en: c.title_en,
        href: c.href,
        links: c.links.map((l) => ({
          label_pl: l.label_pl,
          label_en: l.label_en,
          href: l.href,
          icon: l.icon ?? "",
        })),
      })),
    [config.columns],
  );

  const parentLabel = lang === "en" ? triggerEn || triggerPl : triggerPl;
  const hasContent = cols.length > 0;

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">
          {t("admin.menu.preview", { defaultValue: "Podgląd na żywo (front)" })}
        </span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["pl", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onLangChange(l)}
              className={`px-2 py-0.5 text-[10px] uppercase font-semibold transition-colors ${
                lang === l ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
              }`}
              aria-pressed={lang === l}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {hasContent ? (
        <div
          aria-label={t("admin.menu.previewAria", { defaultValue: "Podgląd mega-menu" })}
          className="rounded-md bg-muted/30 p-3"
        >
          <MegaPanelView
            cols={cols}
            lang={lang}
            parentLabel={parentLabel}
            parentHref="#"
            featured={featured}
            variant="preview"
          />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">
          {t("admin.menu.previewEmpty", {
            defaultValue: "Dodaj co najmniej jedną kolumnę, aby zobaczyć podgląd.",
          })}
        </p>
      )}
    </div>
  );
}

// Picker wyróżnionego wpisu do prawej kolumny mega-panelu.
// Domyślnie (null) = najnowszy opublikowany wpis z okładką.
function FeaturedPostPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: current } = useQuery({
    queryKey: ["mega-featured-current", value],
    enabled: !!value,
    staleTime: 60_000,
    queryFn: async (): Promise<MegaFeaturedPost | null> => {
      if (!value) return null;
      const { data } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format")
        .eq("id", value)
        .maybeSingle();
      return (data as MegaFeaturedPost | null) ?? null;
    },
  });

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["mega-featured-search", search],
    enabled: open,
    staleTime: 30_000,
    queryFn: async (): Promise<{ id: string; title: string; slug: string }[]> => {
      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en")
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false });
      const term = search.trim();
      if (term.length >= 2) {
        q = q.or(`title_pl.ilike.%${term}%,title_en.ilike.%${term}%,slug.ilike.%${term}%`);
      }
      const { data } = await q.limit(20);
      return (data ?? []).map((r) => ({
        id: String(r.id),
        slug: String(r.slug ?? ""),
        title: String(r.title_pl ?? r.title_en ?? r.slug ?? ""),
      }));
    },
  });

  const currentTitle = current
    ? current.title_pl || current.title_en || current.slug || ""
    : "";

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Wyróżniony wpis</span>
        <div className="flex items-center gap-1">
          {value ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => onChange(null)}
            >
              Wyczyść
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => setOpen((o) => !o)}
          >
            {value ? "Zmień" : "Wybierz wpis"}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {value ? (
          <>
            Wybrany: <span className="font-medium text-foreground">{currentTitle || value}</span>
          </>
        ) : (
          "Domyślnie: najnowszy opublikowany wpis z okładką."
        )}
      </p>
      {open && (
        <div className="rounded-md border border-border bg-popover p-2 space-y-2">
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj wpisu..."
            className="h-7 text-xs"
          />
          <div className="max-h-56 overflow-y-auto rounded border border-border bg-background">
            {isFetching && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground text-center">
                <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                Wczytywanie...
              </div>
            )}
            {!isFetching && hits.length === 0 && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground text-center">
                Brak wyników
              </div>
            )}
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onChange(h.id);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-2 py-1 text-xs hover:bg-muted flex items-center gap-2 border-b border-border/60 last:border-b-0 ${
                  value === h.id ? "bg-primary/10" : ""
                }`}
              >
                <span className="flex-1 truncate">{h.title}</span>
                <span className="text-[10px] text-muted-foreground truncate">/{h.slug}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline picker do powiązania kolumny/linku mega-menu z wewnętrzną treścią
// (strony, wpisy, kategorie, tagi). Wypełnia label_pl/label_en/href.
interface PickerResult {
  label_pl: string;
  label_en: string;
  href: string;
}

type PickerTable = "pages" | "posts" | "categories" | "tags";

interface PickerHit {
  id: string;
  slug: string;
  label_pl: string;
  label_en: string;
  href: string;
}

function InternalContentPicker({
  onPick,
  title,
  variant = "icon",
}: {
  onPick: (r: PickerResult) => void;
  title: string;
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [table, setTable] = useState<PickerTable>("pages");
  const [search, setSearch] = useState("");

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["mega-picker", table, search],
    enabled: open,
    staleTime: 30_000,
    queryFn: async (): Promise<PickerHit[]> => {
      const cfg: Record<
        PickerTable,
        { title: string; fallback: string; withStatus: boolean; href: (slug: string) => string }
      > = {
        pages: { title: "title_pl", fallback: "title_en", withStatus: true, href: (s) => `/${s}` },
        posts: { title: "title_pl", fallback: "title_en", withStatus: true, href: (s) => `/post/${s}` },
        categories: { title: "name_pl", fallback: "name_en", withStatus: false, href: (s) => `/category/${s}` },
        tags: { title: "name", fallback: "name", withStatus: false, href: (s) => `/tag/${s}` },
      };
      const c = cfg[table];
      type Builder = {
        eq: (col: string, val: string) => Builder;
        is: (col: string, val: unknown) => Builder;
        or: (expr: string) => Builder;
        order: (col: string) => Builder;
        limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null }>;
      };
      let q = (
        supabase.from(table).select(`id, slug, ${c.title}, ${c.fallback}`) as unknown as Builder
      ).order(c.title);
      if (c.withStatus) q = q.eq("status", "published").is("deleted_at", null);
      const term = search.trim();
      if (term.length >= 2) {
        q = q.or(`${c.title}.ilike.%${term}%,${c.fallback}.ilike.%${term}%,slug.ilike.%${term}%`);
      }
      const { data } = await q.limit(20);
      return (data ?? []).map((r) => {
        const slug = String(r.slug ?? "");
        return {
          id: String(r.id ?? ""),
          slug,
          label_pl: String(r[c.title] ?? r[c.fallback] ?? slug),
          label_en: String(r[c.fallback] ?? r[c.title] ?? slug),
          href: c.href(slug),
        };
      });
    },
  });

  return (
    <div className="relative inline-block">
      {variant === "icon" ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setOpen((o) => !o)}
          title={title}
          aria-label={title}
        >
          <LinkIcon className="h-3 w-3" />
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => setOpen((o) => !o)}
          title={title}
        >
          <LinkIcon className="h-3 w-3 mr-1" />
          + Z treści
        </Button>
      )}
      {open && (
        <div className="absolute z-50 right-0 mt-1 w-80 rounded-md border border-border bg-popover shadow-lg p-2 space-y-2">
          <div className="flex gap-1">
            {(["pages", "posts", "categories", "tags"] as const).map((tbl) => (
              <button
                key={tbl}
                type="button"
                onClick={() => setTable(tbl)}
                className={`flex-1 h-6 px-1 rounded text-[10px] font-medium border ${
                  table === tbl
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {tbl === "pages" ? "Strony" : tbl === "posts" ? "Wpisy" : tbl === "categories" ? "Kategorie" : "Tagi"}
              </button>
            ))}
          </div>
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj..."
            className="h-7 text-xs"
          />
          <div className="max-h-56 overflow-y-auto rounded border border-border bg-background">
            {isFetching && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground text-center">
                <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                Wczytywanie...
              </div>
            )}
            {!isFetching && hits.length === 0 && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground text-center">Brak wyników</div>
            )}
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onPick({ label_pl: h.label_pl, label_en: h.label_en, href: h.href });
                  setOpen(false);
                  setSearch("");
                }}
                className="w-full text-left px-2 py-1 text-xs hover:bg-muted flex items-center gap-2 border-b border-border/60 last:border-b-0"
              >
                <span className="flex-1 truncate">{h.label_pl}</span>
                <span className="text-[10px] text-muted-foreground truncate">{h.href}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
