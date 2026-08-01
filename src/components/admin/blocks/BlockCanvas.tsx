// Refaktor: kanwa bloków z drag&drop (@dnd-kit), atomowymi akcjami i obsługą Enter/Backspace.
// Każda mutacja przechodzi przez `onChange`, który u góry trafia w history hook (undo/redo).
// Zachowania Gutenberga: Enter przenosi karetkę do nowego bloku, Backspace na
// pustym bloku wraca na koniec poprzedniego, Ctrl+C/X/V działa na zaznaczonych
// blokach przez systemowy schowek (interop z WordPressem i innymi wpisami).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { newBlockId } from "@/lib/blocks/types";
import { isTextEntryBlockType, requestBlockFocus } from "@/lib/blocks/focus";
import {
  parseBlocksFromClipboard,
  plainTextToBlocks,
  serializeBlocksForClipboard,
} from "@/lib/blocks/clipboard";
import { looksLikeRichPaste, parseWordHtml } from "@/lib/blocks/wordPaste";
import { getTransformTargets, transformBlock } from "@/lib/blocks/transforms";
import { Plus } from "@/lib/lucide-shim";
import { BlockInserter } from "./BlockInserter";
import { SortableBlockItem } from "./molecules/SortableBlockItem";
import { GenericWidgetToolbar } from "./GenericWidgetToolbar";
import { getBlockVariants } from "@/lib/blocks/variants";
import { BLOCK_SPECS } from "@/lib/blocks/registry";
import { ParagraphBlock } from "./edit/Paragraph";
import { HeadingBlock } from "./edit/Heading";
import { ImageBlock } from "./edit/Image";
import { ListBlockEdit } from "./edit/ListBlock";
import { QuoteBlock } from "./edit/Quote";
import { CodeBlock } from "./edit/Code";
import { EmbedBlock } from "./edit/Embed";
import { VideoBlock } from "./edit/Video";
import { GalleryBlock } from "./edit/Gallery";
import { SeparatorBlock } from "./edit/Separator";
import { CalloutBlock } from "./edit/Callout";
import { TableBlockEdit } from "./edit/Table";
import { ButtonBlock } from "./edit/Button";
import { ColumnsBlock } from "./edit/Columns";
import { HtmlBlock } from "./edit/Html";
import { ReviewBlock } from "./edit/Review";
import { ProsConsBlock } from "./edit/ProsCons";
import { SpoilerBlock } from "./edit/Spoiler";
import { FaqBlock } from "./edit/Faq";
import { TocBlock } from "./edit/Toc";
import { NewsletterBlock } from "./edit/Newsletter";
import { AffiliateBlock } from "./edit/Affiliate";
import { XQuoteBlock } from "./edit/XQuote";
import { CompareBlock } from "./edit/Compare";
import { LoginFormBlock } from "./edit/LoginForm";
import { RegisterFormBlock } from "./edit/RegisterForm";
import { LostPasswordFormBlock } from "./edit/LostPasswordForm";
import { ResetPasswordFormBlock } from "./edit/ResetPasswordForm";
import { AudioBlock } from "./edit/Audio";
import { CoverBlock } from "./edit/Cover";
import { FileBlock } from "./edit/File";
import { MediaTextBlock } from "./edit/MediaText";
import { GroupBlock } from "./edit/Group";
import { SpacerBlock } from "./edit/Spacer";
import { PageBreakBlock } from "./edit/PageBreak";
import { ReadMoreBlock } from "./edit/ReadMore";
import { LiveBlogBlock } from "./edit/LiveBlog";
import { PullquoteBlock } from "./edit/Pullquote";
import { PreformattedBlock } from "./edit/Preformatted";
import { VerseBlock } from "./edit/Verse";
import { DetailsBlock } from "./edit/Details";
import { ButtonsBlock } from "./edit/Buttons";
import { SocialIconsBlock } from "./edit/SocialIcons";
import { SearchBlock } from "./edit/Search";
import { LatestPostsBlock } from "./edit/LatestPosts";
import { TagCloudBlock } from "./edit/TagCloud";
import { CategoriesListBlock } from "./edit/CategoriesList";
import { ArchivesBlock } from "./edit/Archives";
import { CalendarBlock } from "./edit/Calendar";
import {
  PostTitleBlock,
  PostDateBlock,
  PostAuthorBlock,
  PostExcerptBlock,
  PostFeaturedImageBlock,
  PostTermsBlock,
  SiteTitleBlock,
  SiteTaglineBlock,
  SiteLogoBlock,
} from "./edit/ContextBlocks";
import { NavigationBlock, PostNavigationLinkBlock, QueryLoopBlock } from "./edit/NavLoopBlocks";
import {
  BreadcrumbsBlock,
  ReadingTimeBlock,
  ShareButtonsBlock,
  PostViewsBlock,
} from "./edit/PostUtilityBlocks";
import { AuthorBioBlock, RelatedPostsBlock } from "./edit/PostContextBlocks";
import {
  PostStatsBlock,
  PostRatingBlock,
  LoginOutBlock,
  MorePostsBlock,
} from "./edit/FoxizExtraBlocks";
import { AccordionBlock, TabsBlock, CountdownBlock, ProgressBlock } from "./edit/InteractiveBlocks";
import { PollBlockEdit } from "./edit/Poll";
import {
  IconBoxBlock,
  StatsCounterBlock,
  TestimonialsBlock,
  PricingTableBlock,
  TimelineBlock,
} from "./edit/PresentationBlocks";
import {
  HeroBlock,
  CtaSectionBlock,
  ImageCarouselBlock,
  ContactFormBlock,
  MapBlock,
} from "./edit/MarketingBlocks";
import {
  TeamGridBlock,
  LogoGridBlock,
  FeatureGridBlock,
  AlertBannerBlock,
  DividerTextBlock,
} from "./edit/DataSocialBlocks";
import {
  StepListBlock,
  ComparisonTableBlock,
  BannerImageBlock,
  VideoHeroBlock,
} from "./edit/ConversionBlocks";
import { ChartBlock, DataMapBlock } from "./edit/DataVizBlocks";

interface Props {
  doc: BlocksDoc;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (doc: BlocksDoc, immediate?: boolean) => void;
}

/**
 * Stos zamontowanych kanw: przy zagnieżdżeniu (edytor bloków w modalu
 * buildera nad edytorem wpisu) globalne zdarzenia schowka obsługuje wyłącznie
 * kanwa zamontowana najpóźniej - inaczej jedno Ctrl+V wklejałoby dwa razy.
 */
const MOUNTED_CANVASES: HTMLElement[] = [];

export function BlockCanvas({ doc, activeId, onSelect, onChange }: Props) {
  const { t } = useTranslation();
  const blocks = doc.blocks;
  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Zaznaczenie WIELU bloków (Ctrl/Cmd+A jak w Word). Puste = brak zaznaczenia
  // dokumentu; wtedy obowiązuje zwykłe zaznaczenie pojedynczego bloku.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Stable ref to current doc/blocks so callbacks don't churn.
  const docRef = useRef(doc);
  docRef.current = doc;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    MOUNTED_CANVASES.push(el);
    return () => {
      const i = MOUNTED_CANVASES.indexOf(el);
      if (i >= 0) MOUNTED_CANVASES.splice(i, 1);
    };
  }, []);

  const selectAllBlocks = useCallback(() => {
    setSelectedIds(docRef.current.blocks.map((b) => b.id));
    onSelect(null);
  }, [onSelect]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const removeSelected = useCallback(() => {
    const set = new Set(selectedIds);
    if (set.size === 0) return;
    const next = docRef.current.blocks.filter((b) => !set.has(b.id));
    onChange({ ...docRef.current, blocks: next.length ? next : [] }, true);
    setSelectedIds([]);
    onSelect(null);
  }, [selectedIds, onChange, onSelect]);

  // Klawiatura dokumentu: Ctrl/Cmd+A poza edytorem zaznacza wszystkie bloki,
  // Delete/Backspace usuwa zaznaczone, Escape czyści zaznaczenie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !inEditable) {
        e.preventDefault();
        selectAllBlocks();
        return;
      }
      if (selectedIds.length === 0) return;
      if (e.key === "Escape") {
        clearSelection();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !inEditable) {
        e.preventDefault();
        removeSelected();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectAllBlocks, clearSelection, removeSelected, selectedIds.length]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const insertAt = useCallback(
    (idx: number, block: Block, immediate = true) => {
      const next = [...docRef.current.blocks];
      next.splice(idx, 0, block);
      onChange({ ...docRef.current, blocks: next }, immediate);
      onSelect(block.id);
      // Gutenberg-flow: po Enter / wstawieniu bloku tekstowego piszesz dalej
      // bez klikania - karetka ląduje na początku świeżego bloku.
      if (isTextEntryBlockType(block.type)) requestBlockFocus(block.id, "start");
    },
    [onChange, onSelect],
  );

  const replaceBlock = useCallback(
    (id: string, next: Block, immediate = false) => {
      const updated = docRef.current.blocks.map((b) => (b.id === id ? next : b));
      onChange({ ...docRef.current, blocks: updated }, immediate);
    },
    [onChange],
  );

  /** Replace a block in place with one or more new blocks (e.g. markdown transform). */
  const replaceWith = useCallback(
    (id: string, replacement: Block[]) => {
      const idx = docRef.current.blocks.findIndex((b) => b.id === id);
      if (idx < 0) return;
      const next = [...docRef.current.blocks];
      next.splice(idx, 1, ...replacement);
      onChange({ ...docRef.current, blocks: next }, true);
      const last = replacement[replacement.length - 1];
      onSelect(last?.id ?? null);
      // Transformacja (markdown "## " / slash / wklejka) nie może gubić
      // karetki - piszesz dalej na końcu ostatniego bloku zamiennika.
      if (last && isTextEntryBlockType(last.type)) requestBlockFocus(last.id, "end");
    },
    [onChange, onSelect],
  );

  /** Usuwa pusty blok (Backspace) i cofa karetkę na koniec sąsiada - jak w WP. */
  const deleteEmptyAt = useCallback(
    (idx: number) => {
      const arr = docRef.current.blocks;
      if (arr.length <= 1) return;
      const neighbor = arr[idx - 1] ?? arr[idx + 1];
      const next = arr.filter((_, i) => i !== idx);
      onChange({ ...docRef.current, blocks: next }, true);
      if (neighbor) {
        onSelect(neighbor.id);
        if (isTextEntryBlockType(neighbor.type)) requestBlockFocus(neighbor.id, "end");
      } else {
        onSelect(null);
      }
    },
    [onChange, onSelect],
  );

  /** Wstawia wiele bloków pod wskazany indeks (wklejka ze schowka). */
  const insertBlocksAt = useCallback(
    (idx: number, incoming: Block[]) => {
      if (!incoming.length) return;
      const next = [...docRef.current.blocks];
      next.splice(idx, 0, ...incoming);
      onChange({ ...docRef.current, blocks: next }, true);
      const last = incoming[incoming.length - 1];
      onSelect(last.id);
      if (isTextEntryBlockType(last.type)) requestBlockFocus(last.id, "end");
    },
    [onChange, onSelect],
  );

  const move = useCallback(
    (idx: number, dir: -1 | 1) => {
      const j = idx + dir;
      const arr = docRef.current.blocks;
      if (j < 0 || j >= arr.length) return;
      const next = arrayMove(arr, idx, j);
      onChange({ ...docRef.current, blocks: next }, true);
    },
    [onChange],
  );

  const duplicate = useCallback(
    (idx: number) => {
      const orig = docRef.current.blocks[idx];
      if (!orig) return;
      const copy: Block = { ...orig, id: newBlockId() };
      const next = [...docRef.current.blocks];
      next.splice(idx + 1, 0, copy);
      onChange({ ...docRef.current, blocks: next }, true);
    },
    [onChange],
  );

  const remove = useCallback(
    (idx: number) => {
      const removed = docRef.current.blocks[idx];
      const next = docRef.current.blocks.filter((_, i) => i !== idx);
      onChange({ ...docRef.current, blocks: next }, true);
      if (activeId === removed?.id) onSelect(null);
    },
    [onChange, onSelect, activeId],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = docRef.current.blocks.findIndex((b) => b.id === active.id);
      const to = docRef.current.blocks.findIndex((b) => b.id === over.id);
      if (from < 0 || to < 0) return;
      onChange({ ...docRef.current, blocks: arrayMove(docRef.current.blocks, from, to) }, true);
    },
    [onChange],
  );

  /** Bloki objęte operacją schowka: zaznaczenie wielokrotne albo aktywny blok. */
  const clipboardSelection = useCallback((): Block[] => {
    const arr = docRef.current.blocks;
    if (selectedIdsRef.current.length) {
      const set = new Set(selectedIdsRef.current);
      return arr.filter((b) => set.has(b.id));
    }
    const aid = activeIdRef.current;
    return aid ? arr.filter((b) => b.id === aid) : [];
  }, []);

  /** Wkleja bloki: zamienia zaznaczenie wielokrotne albo wstawia po aktywnym. */
  const pasteBlocks = useCallback(
    (incoming: Block[]) => {
      if (!incoming.length) return;
      const arr = docRef.current.blocks;
      const selected = selectedIdsRef.current;
      if (selected.length) {
        const set = new Set(selected);
        const firstIdx = arr.findIndex((b) => set.has(b.id));
        const kept = arr.filter((b) => !set.has(b.id));
        const at = firstIdx < 0 ? kept.length : firstIdx;
        const next = [...kept];
        next.splice(at, 0, ...incoming);
        onChange({ ...docRef.current, blocks: next }, true);
        setSelectedIds([]);
        const last = incoming[incoming.length - 1];
        onSelect(last.id);
        if (isTextEntryBlockType(last.type)) requestBlockFocus(last.id, "end");
      } else {
        const aid = activeIdRef.current;
        const idx = aid ? arr.findIndex((b) => b.id === aid) : -1;
        insertBlocksAt(idx < 0 ? arr.length : idx + 1, incoming);
      }
      toast.success(t("blocks.clipboard.pasted", { count: incoming.length }));
    },
    [insertBlocksAt, onChange, onSelect, t],
  );

  /** Wklejone pliki graficzne -> bloki obrazów (data-URL; upload przy zapisie). */
  const insertImageFiles = useCallback(
    async (files: File[]) => {
      const readAsDataUrl = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      const imageBlocks: Block[] = [];
      for (const file of files) {
        try {
          const url = await readAsDataUrl(file);
          if (!url.startsWith("data:image/")) continue;
          imageBlocks.push({
            id: newBlockId(),
            type: "image",
            data: {
              url,
              alt: file.name.replace(/\.[a-z0-9]+$/i, ""),
              caption: "",
              align: "center",
              size: "full",
              rounded: true,
              shadow: false,
            },
          });
        } catch {
          // pojedynczy nieczytelny plik nie przerywa wklejki
        }
      }
      if (imageBlocks.length) pasteBlocks(imageBlocks);
    },
    [pasteBlocks],
  );

  // Systemowy schowek na poziomie dokumentu (Ctrl+C/X/V jak w Gutenbergu).
  // Zdarzenia w polach tekstowych zostawiamy edytorom inline (TipTap ma własną
  // obsługę wklejania); przy zagnieżdżonych kanwach działa tylko wierzchnia.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      return (
        !!el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      );
    };
    const shouldHandle = (e: ClipboardEvent): boolean => {
      if (isEditableTarget(e.target)) return false;
      const root = rootRef.current;
      if (!root) return false;
      const el = e.target as HTMLElement | null;
      const inSomeCanvas = el?.closest?.("[data-block-canvas]") ?? null;
      if (inSomeCanvas) return inSomeCanvas === root;
      // Zdarzenie poza jakąkolwiek kanwą (fokus na body) - obsługuje wierzchnia.
      return MOUNTED_CANVASES[MOUNTED_CANVASES.length - 1] === root;
    };

    const onCopyOrCut = (e: ClipboardEvent) => {
      if (!shouldHandle(e)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return; // natywne kopiowanie tekstu
      const chosen = clipboardSelection();
      if (!chosen.length || !e.clipboardData) return;
      e.preventDefault();
      const payload = serializeBlocksForClipboard(chosen);
      e.clipboardData.setData("text/html", payload.html);
      e.clipboardData.setData("text/plain", payload.text);
      if (e.type === "cut") {
        const ids = new Set(chosen.map((b) => b.id));
        const next = docRef.current.blocks.filter((b) => !ids.has(b.id));
        onChange({ ...docRef.current, blocks: next }, true);
        setSelectedIds([]);
        onSelect(null);
        toast.success(t("blocks.clipboard.cutDone", { count: chosen.length }));
      } else {
        toast.success(t("blocks.clipboard.copied", { count: chosen.length }));
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!shouldHandle(e)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const html = dt.getData("text/html");
      const plain = dt.getData("text/plain");
      let incoming = parseBlocksFromClipboard(html, plain);
      if (!incoming) {
        const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length) {
          e.preventDefault();
          void insertImageFiles(files);
          return;
        }
        if (html && looksLikeRichPaste(html)) incoming = parseWordHtml(html);
        else if (plain.trim()) incoming = plainTextToBlocks(plain);
      }
      if (!incoming?.length) return;
      e.preventDefault();
      pasteBlocks(incoming);
    };

    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [clipboardSelection, insertImageFiles, onChange, onSelect, pasteBlocks, t]);

  if (blocks.length === 0) {
    // Pusty dokument jak w WP: wiersz „Wpisz / aby wybrać blok" + przycisk „+".
    return (
      <div ref={rootRef} data-block-canvas className="py-8">
        <BlockAppender
          onAppendParagraph={() =>
            insertAt(0, { id: newBlockId(), type: "paragraph", data: { html: "" } })
          }
          onInsert={(b) => insertAt(0, b)}
        />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={rootRef}
          data-block-canvas
          className="block-canvas space-y-0.5"
          data-builder-renderer
          data-cms-content
        >
          <BlockInserter onInsert={(b) => insertAt(0, b)} />
          {blocks.map((b, idx) => {
            const variants = getBlockVariants(b.type);
            const currentVariant =
              typeof b.data.variant === "string" ? (b.data.variant as string) : undefined;
            const transformTargets = getTransformTargets(b).map((type) => ({
              type,
              label: t(`blocks.types.${type}`),
              icon: BLOCK_SPECS[type].icon,
            }));
            return (
              <div key={b.id} data-block-type={b.type}>
                <SortableBlockItem
                  id={b.id}
                  index={idx}
                  total={blocks.length}
                  active={b.id === activeId}
                  selected={selectedSet.has(b.id)}
                  typeLabel={BLOCK_SPECS[b.type]?.label ?? b.type}
                  typeIcon={BLOCK_SPECS[b.type]?.icon}
                  onSelect={() => {
                    setSelectedIds([]);
                    onSelect(b.id);
                  }}
                  onMove={(dir) => move(idx, dir)}
                  onDuplicate={() => duplicate(idx)}
                  onRemove={() => remove(idx)}
                  variants={variants}
                  currentVariant={currentVariant}
                  onVariantChange={(v) =>
                    replaceBlock(b.id, { ...b, data: { ...b.data, variant: v } })
                  }
                  transforms={transformTargets}
                  onTransform={(type) => {
                    const replacement = transformBlock(b, type as Block["type"]);
                    if (replacement) replaceWith(b.id, replacement);
                  }}
                >
                  <BlockWithToolbar
                    block={b}
                    isActive={b.id === activeId}
                    onChange={(n) => replaceBlock(b.id, n)}
                  >
                    <BlockRenderer
                      block={b}
                      isActive={b.id === activeId}
                      onChange={(n) => replaceBlock(b.id, n)}
                      onTransform={(replacement) => replaceWith(b.id, replacement)}
                      onInsertAfter={(blk) => insertAt(idx + 1, blk)}
                      onDeleteEmpty={() => deleteEmptyAt(idx)}
                      onSelectAllBlocks={selectAllBlocks}
                    />
                  </BlockWithToolbar>
                </SortableBlockItem>
                <BlockInserter onInsert={(blk) => insertAt(idx + 1, blk)} />
              </div>
            );
          })}
          <BlockAppender
            onAppendParagraph={() =>
              insertAt(blocks.length, { id: newBlockId(), type: "paragraph", data: { html: "" } })
            }
            onInsert={(b) => insertAt(blocks.length, b)}
          />
        </div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * Dolny appender jak w WordPressie: wiersz-zachęta „Wpisz / aby wybrać blok"
 * (klik = nowy akapit z karetką, w nim działa `/`) + przycisk „+" otwierający
 * szybki inserter.
 */
function BlockAppender({
  onAppendParagraph,
  onInsert,
}: {
  onAppendParagraph: () => void;
  onInsert: (b: Block) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 pl-8 pr-3">
      {open ? (
        <BlockInserter
          variant="controlled"
          open
          autoFocus
          onOpenChange={setOpen}
          onInsert={(b) => {
            setOpen(false);
            onInsert(b);
          }}
        />
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAppendParagraph}
            className="flex-1 text-left py-2 text-sm text-muted-foreground/60 cursor-text select-none"
          >
            {t("blocks.slash.hint")}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("blocks.addBlock")}
            className="w-6 h-6 shrink-0 rounded bg-foreground text-background flex items-center justify-center shadow hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Bloki, które renderują własny wyspecjalizowany floating toolbar. */
const OWN_TOOLBAR_TYPES = new Set(["paragraph", "heading", "image", "video", "audio"]);

function BlockWithToolbar({
  block,
  isActive,
  onChange,
  children,
}: {
  block: Block;
  isActive: boolean;
  onChange: (n: Block) => void;
  children: React.ReactNode;
}) {
  const hasOwn = OWN_TOOLBAR_TYPES.has(block.type);
  if (hasOwn) return <>{children}</>;
  return (
    <div className="relative">
      {isActive && <GenericWidgetToolbar block={block} onChange={onChange} />}
      {children}
    </div>
  );
}

interface RendererProps {
  block: Block;
  isActive: boolean;
  onChange: (n: Block) => void;
  onTransform: (replacement: Block[]) => void;
  onInsertAfter: (b: Block) => void;
  onDeleteEmpty: () => void;
  onSelectAllBlocks: () => void;
}

function BlockRenderer({
  block,
  isActive,
  onChange,
  onTransform,
  onInsertAfter,
  onDeleteEmpty,
  onSelectAllBlocks,
}: RendererProps) {
  switch (block.type) {
    case "paragraph":
      return (
        <ParagraphBlock
          block={block}
          isActive={isActive}
          onChange={onChange}
          onTransform={onTransform}
          onInsertAfter={onInsertAfter}
          onDeleteEmpty={onDeleteEmpty}
          onSelectAllBlocks={onSelectAllBlocks}
        />
      );
    case "heading":
      return (
        <HeadingBlock
          block={block}
          isActive={isActive}
          onChange={onChange}
          onTransform={onTransform}
          onInsertAfter={onInsertAfter}
          onDeleteEmpty={onDeleteEmpty}
          onSelectAllBlocks={onSelectAllBlocks}
        />
      );
    case "image":
      return <ImageBlock block={block} isActive={isActive} onChange={onChange} />;
    case "list":
      return <ListBlockEdit block={block} onChange={onChange} />;
    case "quote":
      return <QuoteBlock block={block} onChange={onChange} />;
    case "code":
      return <CodeBlock block={block} onChange={onChange} />;
    case "embed":
      return <EmbedBlock block={block} onChange={onChange} />;
    case "video":
      return <VideoBlock block={block} isActive={isActive} onChange={onChange} />;
    case "gallery":
      return <GalleryBlock block={block} onChange={onChange} />;
    case "separator":
      return <SeparatorBlock block={block} onChange={onChange} />;
    case "callout":
      return <CalloutBlock block={block} onChange={onChange} />;
    case "table":
      return <TableBlockEdit block={block} onChange={onChange} />;
    case "button":
      return <ButtonBlock block={block} onChange={onChange} />;
    case "columns":
      return <ColumnsBlock block={block} onChange={onChange} />;
    case "html":
      return <HtmlBlock block={block} onChange={onChange} />;
    case "review":
      return <ReviewBlock block={block} onChange={onChange} />;
    case "proscons":
      return <ProsConsBlock block={block} onChange={onChange} />;
    case "spoiler":
      return <SpoilerBlock block={block} onChange={onChange} />;
    case "faq":
      return <FaqBlock block={block} onChange={onChange} />;
    case "toc":
      return <TocBlock block={block} onChange={onChange} />;
    case "newsletter":
      return <NewsletterBlock block={block} onChange={onChange} />;
    case "affiliate":
      return <AffiliateBlock block={block} onChange={onChange} />;
    case "xquote":
      return <XQuoteBlock block={block} onChange={onChange} />;
    case "compare":
      return <CompareBlock block={block} onChange={onChange} />;
    case "login-form":
      return <LoginFormBlock block={block} onChange={onChange} />;
    case "register-form":
      return <RegisterFormBlock block={block} onChange={onChange} />;
    case "lost-password-form":
      return <LostPasswordFormBlock block={block} onChange={onChange} />;
    case "reset-password-form":
      return <ResetPasswordFormBlock block={block} onChange={onChange} />;
    case "audio":
      return <AudioBlock block={block} isActive={isActive} onChange={onChange} />;
    case "cover":
      return <CoverBlock block={block} onChange={onChange} />;
    case "file":
      return <FileBlock block={block} onChange={onChange} />;
    case "media-text":
      return <MediaTextBlock block={block} onChange={onChange} />;
    case "group":
      return <GroupBlock block={block} onChange={onChange} />;
    case "spacer":
      return <SpacerBlock block={block} onChange={onChange} />;
    case "page-break":
      return <PageBreakBlock />;
    case "read-more":
      return <ReadMoreBlock block={block} onChange={onChange} />;
    case "liveblog":
      return <LiveBlogBlock block={block} onChange={onChange} />;
    case "pullquote":
      return <PullquoteBlock block={block} onChange={onChange} />;
    case "preformatted":
      return <PreformattedBlock block={block} onChange={onChange} />;
    case "verse":
      return <VerseBlock block={block} onChange={onChange} />;
    case "details":
      return <DetailsBlock block={block} onChange={onChange} />;
    case "row":
    case "stack":
    case "grid":
      return <GroupBlock block={block} onChange={onChange} />;
    case "buttons":
      return <ButtonsBlock block={block} onChange={onChange} />;
    case "social-icons":
      return <SocialIconsBlock block={block} onChange={onChange} />;
    case "search":
      return <SearchBlock block={block} onChange={onChange} />;
    case "latest-posts":
      return <LatestPostsBlock block={block} onChange={onChange} />;
    case "tag-cloud":
      return <TagCloudBlock block={block} onChange={onChange} />;
    case "categories-list":
      return <CategoriesListBlock block={block} onChange={onChange} />;
    case "archives":
      return <ArchivesBlock block={block} onChange={onChange} />;
    case "calendar":
      return <CalendarBlock block={block} onChange={onChange} />;
    case "post-title":
      return <PostTitleBlock block={block} onChange={onChange} />;
    case "post-date":
      return <PostDateBlock block={block} onChange={onChange} />;
    case "post-author":
      return <PostAuthorBlock block={block} onChange={onChange} />;
    case "post-excerpt":
      return <PostExcerptBlock block={block} onChange={onChange} />;
    case "post-featured-image":
      return <PostFeaturedImageBlock block={block} onChange={onChange} />;
    case "post-terms":
      return <PostTermsBlock block={block} onChange={onChange} />;
    case "site-title":
      return <SiteTitleBlock block={block} onChange={onChange} />;
    case "site-tagline":
      return <SiteTaglineBlock block={block} onChange={onChange} />;
    case "site-logo":
      return <SiteLogoBlock block={block} onChange={onChange} />;
    case "navigation":
      return <NavigationBlock block={block} onChange={onChange} />;
    case "post-navigation-link":
      return <PostNavigationLinkBlock block={block} onChange={onChange} />;
    case "query-loop":
      return <QueryLoopBlock block={block} onChange={onChange} />;
    case "breadcrumbs":
      return <BreadcrumbsBlock block={block} onChange={onChange} />;
    case "reading-time":
      return <ReadingTimeBlock block={block} onChange={onChange} />;
    case "share-buttons":
      return <ShareButtonsBlock block={block} onChange={onChange} />;
    case "post-views":
      return <PostViewsBlock block={block} onChange={onChange} />;
    case "author-bio":
      return <AuthorBioBlock block={block} onChange={onChange} />;
    case "related-posts":
      return <RelatedPostsBlock block={block} onChange={onChange} />;
    case "post-stats":
      return <PostStatsBlock block={block} onChange={onChange} />;
    case "post-rating":
      return <PostRatingBlock block={block} onChange={onChange} />;
    case "loginout":
      return <LoginOutBlock block={block} onChange={onChange} />;
    case "more-posts":
      return <MorePostsBlock block={block} onChange={onChange} />;
    case "accordion":
      return <AccordionBlock block={block} onChange={onChange} />;
    case "tabs":
      return <TabsBlock block={block} onChange={onChange} />;
    case "countdown":
      return <CountdownBlock block={block} onChange={onChange} />;
    case "progress":
      return <ProgressBlock block={block} onChange={onChange} />;
    case "poll":
      return <PollBlockEdit block={block} onChange={onChange} />;
    case "icon-box":
      return <IconBoxBlock block={block} onChange={onChange} />;
    case "stats-counter":
      return <StatsCounterBlock block={block} onChange={onChange} />;
    case "testimonials":
      return <TestimonialsBlock block={block} onChange={onChange} />;
    case "pricing-table":
      return <PricingTableBlock block={block} onChange={onChange} />;
    case "timeline":
      return <TimelineBlock block={block} onChange={onChange} />;
    case "hero":
      return <HeroBlock block={block} onChange={onChange} />;
    case "cta-section":
      return <CtaSectionBlock block={block} onChange={onChange} />;
    case "image-carousel":
      return <ImageCarouselBlock block={block} onChange={onChange} />;
    case "contact-form":
      return <ContactFormBlock block={block} onChange={onChange} />;
    case "map":
      return <MapBlock block={block} onChange={onChange} />;
    case "team-grid":
      return <TeamGridBlock block={block} onChange={onChange} />;
    case "logo-grid":
      return <LogoGridBlock block={block} onChange={onChange} />;
    case "feature-grid":
      return <FeatureGridBlock block={block} onChange={onChange} />;
    case "alert-banner":
      return <AlertBannerBlock block={block} onChange={onChange} />;
    case "divider-text":
      return <DividerTextBlock block={block} onChange={onChange} />;
    case "step-list":
      return <StepListBlock block={block} onChange={onChange} />;
    case "comparison-table":
      return <ComparisonTableBlock block={block} onChange={onChange} />;
    case "banner-image":
      return <BannerImageBlock block={block} onChange={onChange} />;
    case "video-hero":
      return <VideoHeroBlock block={block} onChange={onChange} />;
    case "chart":
      return <ChartBlock block={block} onChange={onChange} />;
    case "data-map":
      return <DataMapBlock block={block} onChange={onChange} />;

    default:
      return <div className="text-xs text-muted-foreground italic py-2">[{block.type}]</div>;
  }
}
