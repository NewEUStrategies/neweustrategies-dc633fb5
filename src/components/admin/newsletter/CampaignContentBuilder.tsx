// Kreator treści kampanii newslettera - liniowy edytor bloków EmailDoc z
// podglądem na żywo. Podgląd używa DOKŁADNIE tego samego renderEmailHtml co
// wysyłka (blok "najnowsze wpisy" rozwiązywany serwerowo), więc redaktor widzi
// to, co dostanie odbiorca.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Trash2,
  Copy,
  Plus,
  Heading,
  Type,
  Image as ImageIcon,
  MousePointerClick,
  Minus,
  MoveVertical,
  Quote,
  Newspaper,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createEmailBlock,
  type EmailBlock,
  type EmailBlockType,
  type EmailDoc,
  type EmailPostListBlock,
} from "@/lib/newsletter/emailDoc";
import { renderEmailHtml, type EmailPostRef } from "@/lib/newsletter/renderEmailHtml";
import { postRefsForLang, type EmailPostRow } from "@/lib/newsletter/emailDocResolve";
import { resolveCampaignDocPosts } from "@/lib/newsletter-campaigns.functions";
import { CampaignBlockProperties } from "./CampaignBlockProperties";

// Paleta WSKAZUJE KLUCZE, nie napisy: pary `{ pl, en }` w tablicy byly kolejnym
// rownoleglym slownikiem poza zasiegiem bramki parytetu.
const PALETTE: { type: EmailBlockType; icon: typeof Heading; labelKey: string }[] = [
  { type: "heading", icon: Heading, labelKey: "adminNewsletter.blocks.heading" },
  { type: "paragraph", icon: Type, labelKey: "adminNewsletter.blocks.paragraph" },
  { type: "image", icon: ImageIcon, labelKey: "adminNewsletter.blocks.image" },
  { type: "button", icon: MousePointerClick, labelKey: "adminNewsletter.blocks.button" },
  { type: "post-list", icon: Newspaper, labelKey: "adminNewsletter.blocks.postList" },
  { type: "quote", icon: Quote, labelKey: "adminNewsletter.blocks.quote" },
  { type: "divider", icon: Minus, labelKey: "adminNewsletter.blocks.divider" },
  { type: "spacer", icon: MoveVertical, labelKey: "adminNewsletter.blocks.spacer" },
  { type: "footer-note", icon: Info, labelKey: "adminNewsletter.blocks.footerNote" },
];

/** Klucz etykiety bloku; nieznany typ degraduje sie do wlasnej nazwy. */
function blockLabelKey(type: EmailBlockType): string | null {
  return PALETTE.find((p) => p.type === type)?.labelKey ?? null;
}

/** Zwraca wartość opóźnioną o `delay` ms - stabilizuje kosztowny podgląd. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

export function CampaignContentBuilder({
  doc,
  onChange,
  previewLang,
  onPreviewLangChange,
}: {
  doc: EmailDoc;
  onChange: (doc: EmailDoc) => void;
  previewLang: "pl" | "en";
  onPreviewLangChange: (lang: "pl" | "en") => void;
}) {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  /** Etykieta bloku ze slownika; nieznany typ degraduje sie do wlasnej nazwy. */
  const blockLabelFor = (type: EmailBlockType): string => {
    const key = blockLabelKey(type);
    return key === null ? type : t(key);
  };
  const [selectedId, setSelectedId] = useState<string | null>(doc.blocks[0]?.id ?? null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setBlocks = (blocks: EmailBlock[]) => onChange({ ...doc, blocks });

  const addBlock = (type: EmailBlockType) => {
    const block = createEmailBlock(type);
    setBlocks([...doc.blocks, block]);
    setSelectedId(block.id);
  };

  const updateBlock = (updated: EmailBlock) =>
    setBlocks(doc.blocks.map((b) => (b.id === updated.id ? updated : b)));

  const removeBlock = (id: string) => {
    setBlocks(doc.blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateBlock = (id: string) => {
    const idx = doc.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const source = doc.blocks[idx];
    // EmailBlock to czysty JSON - klon przez round-trip (bez zależności od
    // structuredClone, nieużywanego nigdzie indziej w repo).
    const copy = {
      ...(JSON.parse(JSON.stringify(source)) as EmailBlock),
      id: createEmailBlock(source.type).id,
    };
    const next = [...doc.blocks];
    next.splice(idx + 1, 0, copy);
    setBlocks(next);
    setSelectedId(copy.id);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = doc.blocks.findIndex((b) => b.id === active.id);
    const to = doc.blocks.findIndex((b) => b.id === over.id);
    if (from < 0 || to < 0) return;
    setBlocks(arrayMove(doc.blocks, from, to));
  };

  const selected = doc.blocks.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <div className="space-y-3">
        {/* Paleta bloków */}
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((p) => (
            <Button
              key={p.type}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[12px]"
              onClick={() => addBlock(p.type)}
            >
              <p.icon className="w-3.5 h-3.5 mr-1" />
              {t(p.labelKey)}
            </Button>
          ))}
        </div>

        {/* Lista bloków (sortowalna) */}
        {doc.blocks.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-[13px] text-muted-foreground">
            {t("adminNewsletter.blocks.emptyDocument")}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={doc.blocks.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {doc.blocks.map((block) => (
                  <SortableBlockRow
                    key={block.id}
                    block={block}
                    selected={block.id === selectedId}
                    label={blockLabelFor(block.type)}
                    onSelect={() => setSelectedId(block.id)}
                    onRemove={() => removeBlock(block.id)}
                    onDuplicate={() => duplicateBlock(block.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {/* Właściwości zaznaczonego bloku */}
        {selected && (
          <div className="rounded-md border p-3">
            <div className="text-[12px] font-medium mb-2">
              {t("adminNewsletter.blocks.properties")}: {blockLabelFor(selected.type)}
            </div>
            <CampaignBlockProperties block={selected} onChange={updateBlock} />
          </div>
        )}
      </div>

      {/* Podgląd na żywo */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium">{t("adminNewsletter.blocks.preview")}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={previewLang === "pl" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => onPreviewLangChange("pl")}
            >
              PL
            </Button>
            <Button
              type="button"
              size="sm"
              variant={previewLang === "en" ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => onPreviewLangChange("en")}
            >
              EN
            </Button>
          </div>
        </div>
        <CampaignPreview doc={doc} lang={previewLang} />
      </div>
    </div>
  );
}

function SortableBlockRow({
  block,
  selected,
  label,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  block: EmailBlock;
  selected: boolean;
  label: string;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border bg-card p-2 ${
        selected ? "ring-2 ring-brand" : ""
      } ${isDragging ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        aria-label={t("adminNewsletter.blocks.drag")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <button type="button" className="flex-1 text-left text-[13px] font-medium" onClick={onSelect}>
        {label}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onDuplicate}
        aria-label={t("adminNewsletter.blocks.duplicate")}
      >
        <Copy className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive"
        onClick={onRemove}
        aria-label={t("adminNewsletter.blocks.remove")}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function CampaignPreview({ doc, lang }: { doc: EmailDoc; lang: "pl" | "en" }) {
  ensureNewsletterAdminI18n();
  const { t } = useTranslation();
  const resolve = useServerFn(resolveCampaignDocPosts);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // Debounce dokumentu zasilającego podgląd: przepisywanie srcDoc iframe przy
  // każdym naciśnięciu klawisza migotałoby i marnowało pracę. 300 ms daje
  // płynne pisanie i szybki podgląd po pauzie.
  const debouncedDoc = useDebouncedValue(doc, 300);

  // Rozwiąż bloki "najnowsze wpisy" na wpisy - tym samym kodem co wysyłka.
  // Klucz zapytania obejmuje TYLKO pola wpływające na dobór wpisów (mode,
  // count, kategoria, ręczne id), więc edycja nagłówka sekcji czy układu nie
  // powoduje ponownego pobrania z serwera.
  const postListKey = useMemo(
    () =>
      debouncedDoc.blocks
        .filter((b): b is EmailPostListBlock => b.type === "post-list")
        .map((b) => ({
          id: b.id,
          mode: b.mode,
          count: b.count,
          categorySlug: b.categorySlug,
          postIds: b.postIds,
        })),
    [debouncedDoc],
  );
  const hasPostList = postListKey.length > 0;
  const postsQ = useQuery({
    queryKey: ["campaign-doc-posts", JSON.stringify(postListKey)],
    enabled: hasPostList,
    queryFn: async () => {
      const r = await resolve({ data: { doc: debouncedDoc } });
      return JSON.parse((r as { json: string }).json) as Record<string, EmailPostRow[]>;
    },
  });

  const html = useMemo(() => {
    const rowsByBlock = postsQ.data ?? {};
    const postsByBlock: Record<string, EmailPostRef[]> = postRefsForLang(
      rowsByBlock,
      origin || "https://example.com",
      lang,
    );
    return renderEmailHtml(debouncedDoc, lang, { postsByBlock });
  }, [debouncedDoc, lang, postsQ.data, origin]);

  return (
    <div className="rounded-md border bg-[#f3f4f6] p-3 overflow-x-auto">
      {html ? (
        <iframe
          title={t("adminNewsletter.blocks.previewFrameTitle")}
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0">${html}</body></html>`}
          className="w-full h-[600px] border-0 bg-white rounded"
          sandbox=""
        />
      ) : (
        <p className="text-[12px] text-muted-foreground py-8 text-center">
          {t("adminNewsletter.blocks.noContentInLang")}
        </p>
      )}
    </div>
  );
}
