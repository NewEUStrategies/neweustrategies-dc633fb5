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
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Trash2,
  Copy,
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
import {
  createEmailBlock,
  type EmailBlock,
  type EmailBlockType,
  type EmailDoc,
} from "@/lib/newsletter/emailDoc";
import { renderEmailHtml, type EmailPostRef } from "@/lib/newsletter/renderEmailHtml";
import { postRefsForLang, type EmailPostRow } from "@/lib/newsletter/emailDocResolve";
import { resolveCampaignDocPosts } from "@/lib/newsletter-campaigns.functions";
import { CampaignBlockProperties } from "./CampaignBlockProperties";
import * as rules from "./campaignBlocks";

// Paleta WSKAZUJE KLUCZE, nie napisy: pary `{ pl, en }` w tablicy byly kolejnym
// rownoleglym slownikiem poza zasiegiem bramki parytetu. Same klucze zyja w
// `campaignBlocks.ts` razem z regulami edytora.
const PALETTE: { type: EmailBlockType; icon: typeof Heading }[] = [
  { type: "heading", icon: Heading },
  { type: "paragraph", icon: Type },
  { type: "image", icon: ImageIcon },
  { type: "button", icon: MousePointerClick },
  { type: "post-list", icon: Newspaper },
  { type: "quote", icon: Quote },
  { type: "divider", icon: Minus },
  { type: "spacer", icon: MoveVertical },
  { type: "footer-note", icon: Info },
];

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
    const key = rules.blockLabelKey(type);
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
    setBlocks(rules.appendBlock(doc.blocks, block));
    setSelectedId(block.id);
  };

  const updateBlock = (updated: EmailBlock) => setBlocks(rules.updateBlock(doc.blocks, updated));

  const removeBlock = (id: string) => {
    setBlocks(rules.removeBlock(doc.blocks, id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateBlock = (id: string) => {
    const result = rules.duplicateBlock(doc.blocks, id);
    if (!result) return;
    setBlocks(result.blocks);
    setSelectedId(result.copyId);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const next = rules.reorderBlocks(doc.blocks, String(active.id), over ? String(over.id) : null);
    if (next) setBlocks(next);
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
              {blockLabelFor(p.type)}
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
  const postListKey = useMemo(() => rules.postListSelectors(debouncedDoc), [debouncedDoc]);
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
