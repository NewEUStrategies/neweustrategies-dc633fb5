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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Save,
  Trash2,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Link as LinkIcon,
  FileText,
  BookOpen,
  Folder,
  Tags as TagIcon,
  Sparkles,
  Star,
} from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { saveMenu as saveMenuFn } from "@/lib/menus/menu.functions";
import { menuWithItemsQueryOptions } from "@/lib/menus/queries";
import { AddItemPanel } from "./AddItemPanel";
import { MegaPanelView } from "@/components/menu/MegaPanelView";
import { LucideIconPicker } from "@/components/admin/builder/ui/molecules/LucideIconPicker";
import { megaFeaturedPostQueryOptions, type MegaFeaturedPost } from "@/lib/menus/megaFeatured";

import { type MenuItemInput, type MenuItemType, type MegaConfig } from "@/lib/menus/types";
import {
  MAX_MENU_DEPTH,
  appendMenuItems,
  buildMenuTree,
  dropZoneForOffset,
  indentMenuItem,
  moveMenuItem,
  outdentMenuItem,
  parentToExpandOnIndent,
  removeMenuSubtree,
  toSavePayload,
  updateMenuItemById,
  type MenuClientItem,
  type MenuDropMode,
  type MenuTreeNode,
} from "@/lib/menus/tree";
import {
  addMegaColumn,
  columnPickedContent,
  deriveMegaColumns,
  linkPickedContent,
  removeMegaColumn,
  removeMegaLink,
  updateMegaColumn,
  updateMegaLink,
  addMegaLink,
} from "@/lib/menus/megaColumns";

interface Props {
  menuKey: string;
}

// Praca w klientowym modelu: każdy item ma stabilne `local_id`, hierarchia
// przez `parent_local_id`. Kształt i WSZYSTKIE reguły drzewa mieszkają
// w `lib/menus/tree.ts` - ten plik jest kompozycją, nie miejscem na logikę.
type ClientItem = MenuClientItem;
type TreeNode = MenuTreeNode<ClientItem>;

const DND_MIME = "application/x-menu-item";

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
      icon: it.icon ?? "",
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
      toast.success(t("admin.menu.saved"));
      await qc.invalidateQueries({ queryKey: ["menu-with-items", menuKey] });
      await qc.invalidateQueries({ queryKey: ["public-menu", menuKey] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("admin.menu.saveError") + `: ${msg}`);
    },
  });

  const tree = useMemo(() => buildMenuTree(items ?? []), [items]);

  // Poniżej: WYŁĄCZNIE spięcie stanu z regułami. Każda z tych operacji to
  // czysty reduktor z `lib/menus/tree.ts` - hierarchia, limit poziomów,
  // ochrona przed cyklem i renumeracja rzędu mają tam własne asercje.
  const updateItem = (local_id: string, patch: Partial<ClientItem>) => {
    setItems((curr) => [...updateMenuItemById(curr ?? [], local_id, patch)]);
  };

  const removeItem = (local_id: string) => {
    setItems((curr) => (curr ? [...removeMenuSubtree(curr, local_id)] : curr));
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
    setItems((curr) => [...appendMenuItems(curr ?? [], payloads, rid)]);
  };

  const moveItem = (dragId: string, targetId: string | null, mode: MenuDropMode) => {
    setItems((curr) => (curr ? [...moveMenuItem(curr, dragId, targetId, mode)] : curr));
  };

  // Podpięcie w prawo: element staje się dzieckiem swojego poprzedniego
  // rodzeństwa - i ta gałąź musi się rozwinąć, inaczej pozycja „znika".
  const indentItem = (local_id: string) => {
    setItems((curr) => (curr ? [...indentMenuItem(curr, local_id)] : curr));
    setExpanded((s) => {
      const parent = parentToExpandOnIndent(items ?? [], local_id);
      if (!parent) return s;
      const next = new Set(s);
      next.add(parent);
      return next;
    });
  };

  // Cofnięcie w lewo: element wychodzi poziom wyżej, tuż za swoim rodzicem.
  const outdentItem = (local_id: string) => {
    setItems((curr) => (curr ? [...outdentMenuItem(curr, local_id)] : curr));
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
    // Etykieta zastępcza idzie ZE SŁOWNIKA, bo ląduje w bazie i pokaże się
    // czytelnikowi w nawigacji - zaszyty w kodzie napis „(bez nazwy)" trafiał
    // do menu także w wersji angielskiej.
    saveMutation.mutate(toSavePayload(items, t("admin.menu.untitledItem")));
  };

  if (menuQuery.isLoading || items === null) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-6">
      <aside className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("admin.menu.addItem")}</h2>
        <AddItemPanel onAdd={addItems} />
      </aside>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {t("admin.menu.structure")} · {menuKey}
            </h2>
            <p className="text-xs text-muted-foreground">{t("admin.menu.dragHint")}</p>
          </div>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            {t("common.save")}
          </Button>
        </div>

        <div
          className="space-y-2 rounded-xl border border-border/70 bg-gradient-to-b from-muted/20 to-card p-4 min-h-[200px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const dragId = e.dataTransfer.getData(DND_MIME);
            if (dragId) moveItem(dragId, null, "after");
          }}
        >
          {tree.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              {t("admin.menu.emptyMenu")}
            </p>
          )}
          {tree.length > 0 && (
            <div className="flex items-center gap-2 border-b border-border/50 pb-2 mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              <span
                aria-hidden
                className="inline-block h-3 w-1 rounded-sm"
                style={{ background: "var(--brand)" }}
              />
              <span>Poziom 1 · pozycje główne</span>
              <span className="ml-auto opacity-60">
                {tree.length} {tree.length === 1 ? "pozycja" : "pozycji"}
              </span>
            </div>
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

function MenuNode({
  node,
  depth,
  siblingIndex,
  expanded,
  onToggleExpanded,
  onUpdate,
  onRemove,
  onMove,
  onIndent,
  onOutdent,
}: NodeProps) {
  const { t } = useTranslation();
  const { item, children } = node;
  const isOpen = expanded.has(item.local_id);
  const hasChildren = children.length > 0;
  const [dropZone, setDropZone] = useState<MenuDropMode | null>(null);

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_MIME, item.local_id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    setDropZone(dropZoneForOffset(ratio, depth));
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
      ? t("admin.menu.typePage")
      : item.item_type === "post"
        ? t("admin.menu.typePost")
        : item.item_type === "category"
          ? t("admin.menu.typeCategory")
          : item.item_type === "tag"
            ? t("admin.menu.typeTag")
            : t("admin.menu.typeCustom");

  // Type icon + depth-aware color for the type chip.
  const TypeIcon =
    item.item_type === "page"
      ? FileText
      : item.item_type === "post"
        ? BookOpen
        : item.item_type === "category"
          ? Folder
          : item.item_type === "tag"
            ? TagIcon
            : LinkIcon;

  const configuredCols = item.mega_config?.columns ?? [];
  const megaColsCount = configuredCols.length;
  const megaLinksCount = configuredCols.reduce((sum, c) => sum + (c.links?.length ?? 0), 0);
  const megaHasFeatured = !!item.mega_config?.featured_post_id;
  const hasNestedChildren = children.some((c) => c.children.length > 0);
  const isMegaLike = depth === 0 && (item.mega_enabled || hasNestedChildren);
  // Front auto-buduje kolumny z drzewa, gdy admin nie skonfigurował własnych.
  const derivedColsCount = children.length;
  const derivedLinksCount = children.reduce((sum, c) => sum + c.children.length, 0);
  const usingDerivedMega = item.mega_enabled && megaColsCount === 0 && derivedColsCount > 0;
  const displayColsCount = megaColsCount > 0 ? megaColsCount : derivedColsCount;
  const displayLinksCount = megaColsCount > 0 ? megaLinksCount : derivedLinksCount;

  // Depth-aware surface: root = strong card; L2 = softer chip; L3 = compact row.
  const cardClass =
    depth === 0
      ? "border border-border/70 rounded-lg bg-card shadow-sm hover:shadow-md transition-all"
      : depth === 1
        ? "border border-border/50 rounded-md bg-background/70 transition-all"
        : "border border-border/30 rounded bg-muted/30 transition-all";
  const paddingClass = depth === 0 ? "px-3 py-2.5" : depth === 1 ? "px-3 py-2" : "px-2.5 py-1.5";
  const titleClass =
    depth === 0
      ? "text-sm font-bold text-foreground"
      : depth === 1
        ? "text-xs font-semibold text-foreground/90"
        : "text-[11px] font-medium text-foreground/80";

  return (
    <div className="relative">
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => setDropZone(null)}
        onDrop={onDrop}
        className={
          cardClass +
          " " +
          (dropZone === "before"
            ? "!border-t-2 !border-t-brand shadow-[0_-2px_0_var(--brand)] "
            : "") +
          (dropZone === "after"
            ? "!border-b-2 !border-b-brand shadow-[0_2px_0_var(--brand)] "
            : "") +
          (dropZone === "child" ? "ring-2 ring-brand/60 bg-brand/5 " : "")
        }
      >
        <div className={"flex items-center gap-2 cursor-move " + paddingClass}>
          {/* Depth-0: brand accent bar */}
          {depth === 0 ? (
            <span
              aria-hidden
              className="inline-block h-6 w-1 shrink-0 rounded-sm"
              style={{ background: isMegaLike ? "var(--brand)" : "hsl(var(--border))" }}
            />
          ) : null}
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
          <button
            type="button"
            onClick={() => onToggleExpanded(item.local_id)}
            className="p-1 -m-1 hover:bg-muted rounded shrink-0 transition-colors"
            aria-label={isOpen ? "Zwiń" : "Rozwiń"}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          <span
            className={
              "flex items-center justify-center rounded-md shrink-0 " +
              (depth === 0 ? "h-7 w-7 bg-muted ring-1 ring-border/60" : "h-5 w-5 bg-muted/60")
            }
            aria-hidden
          >
            <TypeIcon size={depth === 0 ? 14 : 11} className="text-muted-foreground" />
          </span>
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <span className={titleClass + " truncate max-w-[240px]"}>
              {item.label_pl || "(bez nazwy)"}
            </span>
            {item.label_en && depth === 0 ? (
              <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">
                / {item.label_en}
              </span>
            ) : null}
            {item.href ? (
              <span className="text-[10px] font-mono text-muted-foreground/70 truncate max-w-[220px]">
                {item.href}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1 shrink-0">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80 px-1.5 py-0.5 rounded bg-muted/60">
                {typeLabel}
              </span>
              {isMegaLike ? (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    background: "color-mix(in oklab, var(--brand) 14%, transparent)",
                    color: "var(--brand)",
                  }}
                  title={`${displayColsCount} kolumn · ${displayLinksCount} linków${usingDerivedMega ? " · auto z drzewa" : ""}${megaHasFeatured ? " · Wyróżniony" : ""}`}
                >
                  <Sparkles size={10} />
                  Mega
                  {usingDerivedMega ? (
                    <span className="ml-1 rounded bg-amber-100 px-1 py-[1px] text-[8px] text-amber-800">
                      auto
                    </span>
                  ) : null}
                </span>
              ) : null}
              {megaHasFeatured ? (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600"
                  title="Wyróżniony wpis skonfigurowany"
                >
                  <Star size={10} />
                  Featured
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => onOutdent(item.local_id)}
              disabled={depth === 0}
              aria-label={t("admin.menu.outdent")}
              title={t("admin.menu.outdent")}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => onIndent(item.local_id)}
              disabled={siblingIndex === 0 || depth + 1 >= MAX_MENU_DEPTH}
              aria-label={t("admin.menu.indent")}
              title={t("admin.menu.indent")}
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:bg-destructive/10"
              onClick={() => onRemove(item.local_id)}
              aria-label={t("common.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Mega summary strip - visible when collapsed */}
        {!isOpen && isMegaLike && displayColsCount > 0 ? (
          <div className="border-t border-border/40 px-3 py-1.5 flex items-center gap-3 text-[10px] text-muted-foreground bg-muted/20">
            <span className="inline-flex items-center gap-1">
              <span className="font-bold text-foreground/70">{displayColsCount}</span> kolumn
            </span>
            <span className="opacity-30">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="font-bold text-foreground/70">{displayLinksCount}</span> linków
            </span>
            {usingDerivedMega ? (
              <>
                <span className="opacity-30">·</span>
                <span className="inline-flex items-center gap-1 text-amber-700">auto z drzewa</span>
              </>
            ) : null}
            {megaHasFeatured ? (
              <>
                <span className="opacity-30">·</span>
                <span className="inline-flex items-center gap-1 text-amber-600">
                  <Star size={10} /> Wyróżniony wpis
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        {isOpen && (
          <div className="border-t border-border/60 p-3 space-y-2 bg-muted/20 rounded-b-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Field label={t("admin.menu.labelPl")}>
                <Input
                  value={item.label_pl}
                  onChange={(e) => onUpdate(item.local_id, { label_pl: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              <Field label={t("admin.menu.labelEn")}>
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
              <Field label={t("admin.menu.target")}>
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
                    <SelectItem value="_self">{t("admin.menu.targetSelf")}</SelectItem>
                    <SelectItem value="_blank">{t("admin.menu.targetBlank")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("admin.menu.cssClass")}>
                <Input
                  value={item.css_class}
                  onChange={(e) => onUpdate(item.local_id, { css_class: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              <Field label={t("admin.menu.icon")}>
                <div className="h-8 flex items-center">
                  <LucideIconPicker
                    value={item.icon}
                    onChange={(name) => onUpdate(item.local_id, { icon: name ?? "" })}
                  />
                </div>
              </Field>
              {depth === 0 && (
                <Field label={t("admin.menu.megaToggle")}>
                  <div className="flex items-center gap-2 h-8">
                    <Switch
                      checked={item.mega_enabled}
                      onCheckedChange={(v) => onUpdate(item.local_id, { mega_enabled: v })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {item.mega_enabled ? t("admin.menu.megaOn") : t("admin.menu.megaOff")}
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
                treeChildren={children}
                onChange={(cfg) => onUpdate(item.local_id, { mega_config: cfg })}
              />
            )}
          </div>
        )}
      </div>

      {hasChildren && (
        <div
          className={
            "mt-2 space-y-1.5 relative " +
            (depth === 0
              ? "ml-6 pl-4 border-l-2 border-brand/30"
              : "ml-5 pl-3 border-l border-border/50")
          }
        >
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
  treeChildren,
}: {
  config: MegaConfig;
  onChange: (cfg: MegaConfig) => void;
  triggerPl: string;
  triggerEn: string;
  treeChildren: TreeNode[];
}) {
  const { t } = useTranslation();
  const [previewLang, setPreviewLang] = useState<"pl" | "en">("pl");
  // Wszystkie operacje na układzie to reduktory z `lib/menus/megaColumns.ts` -
  // tu zostaje wyłącznie podpięcie ich pod pola formularza.
  const derivedCols = useMemo(() => deriveMegaColumns(treeChildren), [treeChildren]);
  const importFromTree = () => onChange({ ...config, columns: derivedCols });
  const addColumn = () => onChange(addMegaColumn(config));
  const updateColumn = (idx: number, patch: Partial<MegaConfig["columns"][number]>) =>
    onChange(updateMegaColumn(config, idx, patch));
  const removeColumn = (idx: number) => onChange(removeMegaColumn(config, idx));

  return (
    <div className="border border-border rounded-md p-3 space-y-2 bg-background">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{t("admin.menu.megaColumns")}</span>
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
          <Select
            value={config.width}
            onValueChange={(v) => onChange({ ...config, width: v as "container" | "full" })}
          >
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
                onPick={(p) => updateColumn(idx, columnPickedContent(col, p))}
                title="Powiąż nagłówek kolumny z treścią"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => removeColumn(idx)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <div className="pl-2 space-y-1">
              {col.links.map((l, li) => (
                <div key={li} className="flex items-center gap-1">
                  <LucideIconPicker
                    value={l.icon}
                    onChange={(name) =>
                      onChange(updateMegaLink(config, idx, li, { icon: name ?? "" }))
                    }
                    className="h-7"
                    placeholder="Ikona"
                  />
                  <Input
                    value={l.label_pl}
                    onChange={(e) =>
                      onChange(updateMegaLink(config, idx, li, { label_pl: e.target.value }))
                    }
                    placeholder="Etykieta PL"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={l.label_en}
                    onChange={(e) =>
                      onChange(updateMegaLink(config, idx, li, { label_en: e.target.value }))
                    }
                    placeholder="EN"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={l.href}
                    onChange={(e) =>
                      onChange(updateMegaLink(config, idx, li, { href: e.target.value }))
                    }
                    placeholder="href"
                    className="h-7 text-xs"
                  />
                  <InternalContentPicker
                    onPick={(p) =>
                      onChange(updateMegaLink(config, idx, li, linkPickedContent(l, p)))
                    }
                    title="Powiąż link z treścią wewnętrzną"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    onClick={() => onChange(removeMegaLink(config, idx, li))}
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
                  onClick={() => onChange(addMegaLink(config, idx))}
                >
                  + Własny link
                </Button>
                <InternalContentPicker
                  onPick={(p) =>
                    onChange(
                      addMegaLink(config, idx, {
                        label_pl: p.label_pl,
                        label_en: p.label_en,
                        href: p.href,
                        icon: "",
                      }),
                    )
                  }
                  title="Dodaj link z wewnętrznej treści"
                  variant="button"
                />
              </div>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={addColumn}>
            + {t("admin.menu.addColumn")}
          </Button>
          {derivedCols.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={importFromTree}
              title={t("admin.menu.importFromTreeHint")}
            >
              {config.columns.length === 0
                ? t("admin.menu.importFromTree")
                : t("admin.menu.overwriteFromTree")}
            </Button>
          ) : null}
        </div>
        {config.columns.length === 0 && derivedCols.length > 0 ? (
          <p className="text-[11px] text-muted-foreground italic">
            {t("admin.menu.autoDerivedHint")}
          </p>
        ) : null}
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
        derivedCols={derivedCols}
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
  derivedCols,
}: {
  config: MegaConfig;
  triggerPl: string;
  triggerEn: string;
  lang: "pl" | "en";
  onLangChange: (l: "pl" | "en") => void;
  derivedCols: MegaConfig["columns"];
}) {
  const { t } = useTranslation();
  const featuredQuery = useQuery(megaFeaturedPostQueryOptions(config.featured_post_id ?? null));
  const featured = featuredQuery.data ?? null;

  // 1:1 z SiteMenu: gdy konfiguracja kolumn jest pusta, front auto-buduje kolumny
  // z drzewa dzieci tej pozycji. Admin musi pokazać dokładnie ten sam widok.
  const configuredCols = config.columns;
  const usingDerived = configuredCols.length === 0;
  const cols = useMemo(() => {
    const source = usingDerived ? derivedCols : configuredCols;
    return source.map((c) => ({
      title_pl: c.title_pl,
      title_en: c.title_en,
      href: c.href,
      links: c.links.map((l) => ({
        label_pl: l.label_pl,
        label_en: l.label_en,
        href: l.href,
        icon: l.icon ?? "",
      })),
    }));
  }, [usingDerived, configuredCols, derivedCols]);

  const parentLabel = lang === "en" ? triggerEn || triggerPl : triggerPl;
  const hasContent = cols.length > 0;

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">
          {t("admin.menu.preview")}
          {usingDerived && hasContent ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">
              {t("admin.menu.autoFromTree")}
            </span>
          ) : null}
        </span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["pl", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onLangChange(l)}
              className={`px-2 py-0.5 text-[10px] uppercase font-semibold transition-colors ${
                lang === l
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
              aria-pressed={lang === l}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {hasContent ? (
        <div aria-label={t("admin.menu.previewAria")} className="rounded-md bg-muted/30 p-3">
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
        <p className="text-[11px] text-muted-foreground italic">{t("admin.menu.previewEmpty")}</p>
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
        .select(
          "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id",
        )
        .eq("id", value)
        .maybeSingle();
      const raw = data as {
        id: string;
        slug: string;
        title_pl: string | null;
        title_en: string | null;
        excerpt_pl: string | null;
        excerpt_en: string | null;
        cover_image_url: string | null;
        published_at: string | null;
        post_format: string | null;
        author_id: string | null;
      } | null;
      if (!raw) return null;
      if (!raw.author_id) {
        return {
          ...raw,
          author_display_name: null,
          author_slug: null,
          author_avatar_url: null,
        };
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, slug, avatar_url")
        .eq("id", raw.author_id)
        .maybeSingle();
      const p = prof as {
        display_name: string | null;
        slug: string | null;
        avatar_url: string | null;
      } | null;
      return {
        ...raw,
        author_display_name: p?.display_name ?? null,
        author_slug: p?.slug ?? null,
        author_avatar_url: p?.avatar_url ?? null,
      };
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

  const currentTitle = current ? current.title_pl || current.title_en || current.slug || "" : "";

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
        posts: {
          title: "title_pl",
          fallback: "title_en",
          withStatus: true,
          href: (s) => `/post/${s}`,
        },
        categories: {
          title: "name_pl",
          fallback: "name_en",
          withStatus: false,
          href: (s) => `/category/${s}`,
        },
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
          <LinkIcon className="h-3 w-3 mr-1" />+ Z treści
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
                {tbl === "pages"
                  ? "Strony"
                  : tbl === "posts"
                    ? "Wpisy"
                    : tbl === "categories"
                      ? "Kategorie"
                      : "Tagi"}
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
              <div className="px-2 py-2 text-[11px] text-muted-foreground text-center">
                Brak wyników
              </div>
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
