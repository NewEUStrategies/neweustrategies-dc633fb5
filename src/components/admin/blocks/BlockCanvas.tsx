// Refaktor: kanwa bloków z drag&drop (@dnd-kit), atomowymi akcjami i obsługą Enter/Backspace.
// Każda mutacja przechodzi przez `onChange`, który u góry trafia w history hook (undo/redo).

import { useCallback, useMemo, useRef } from "react";
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
import { BlockInserter } from "./BlockInserter";
import { SortableBlockItem } from "./molecules/SortableBlockItem";
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
import { PullquoteBlock } from "./edit/Pullquote";
import { PreformattedBlock } from "./edit/Preformatted";
import { VerseBlock } from "./edit/Verse";
import { DetailsBlock } from "./edit/Details";
import { ButtonsBlock } from "./edit/Buttons";
import { SocialIconsBlock } from "./edit/SocialIcons";
import { SearchBlock } from "./edit/Search";
import { LatestPostsBlock } from "./edit/LatestPosts";

interface Props {
  doc: BlocksDoc;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (doc: BlocksDoc, immediate?: boolean) => void;
}

export function BlockCanvas({ doc, activeId, onSelect, onChange }: Props) {
  const blocks = doc.blocks;
  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);

  // Stable ref to current doc/blocks so callbacks don't churn.
  const docRef = useRef(doc);
  docRef.current = doc;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const insertAt = useCallback((idx: number, block: Block, immediate = true) => {
    const next = [...docRef.current.blocks];
    next.splice(idx, 0, block);
    onChange({ ...docRef.current, blocks: next }, immediate);
    onSelect(block.id);
  }, [onChange, onSelect]);

  const replaceBlock = useCallback((id: string, next: Block, immediate = false) => {
    const updated = docRef.current.blocks.map((b) => (b.id === id ? next : b));
    onChange({ ...docRef.current, blocks: updated }, immediate);
  }, [onChange]);

  /** Replace a block in place with one or more new blocks (e.g. markdown transform). */
  const replaceWith = useCallback((id: string, replacement: Block[]) => {
    const idx = docRef.current.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const next = [...docRef.current.blocks];
    next.splice(idx, 1, ...replacement);
    onChange({ ...docRef.current, blocks: next }, true);
    onSelect(replacement[replacement.length - 1]?.id ?? null);
  }, [onChange, onSelect]);

  const move = useCallback((idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    const arr = docRef.current.blocks;
    if (j < 0 || j >= arr.length) return;
    const next = arrayMove(arr, idx, j);
    onChange({ ...docRef.current, blocks: next }, true);
  }, [onChange]);

  const duplicate = useCallback((idx: number) => {
    const orig = docRef.current.blocks[idx];
    if (!orig) return;
    const copy: Block = { ...orig, id: newBlockId() };
    const next = [...docRef.current.blocks];
    next.splice(idx + 1, 0, copy);
    onChange({ ...docRef.current, blocks: next }, true);
  }, [onChange]);

  const remove = useCallback((idx: number) => {
    const removed = docRef.current.blocks[idx];
    const next = docRef.current.blocks.filter((_, i) => i !== idx);
    onChange({ ...docRef.current, blocks: next }, true);
    if (activeId === removed?.id) onSelect(null);
  }, [onChange, onSelect, activeId]);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = docRef.current.blocks.findIndex((b) => b.id === active.id);
    const to = docRef.current.blocks.findIndex((b) => b.id === over.id);
    if (from < 0 || to < 0) return;
    onChange({ ...docRef.current, blocks: arrayMove(docRef.current.blocks, from, to) }, true);
  }, [onChange]);

  if (blocks.length === 0) {
    return (
      <div className="py-12">
        <BlockInserter variant="fab" onInsert={(b) => insertAt(0, b)} />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="block-canvas space-y-0.5">
          <BlockInserter onInsert={(b) => insertAt(0, b)} />
          {blocks.map((b, idx) => (
            <div key={b.id}>
              <SortableBlockItem
                id={b.id}
                index={idx}
                total={blocks.length}
                active={b.id === activeId}
                onSelect={() => onSelect(b.id)}
                onMove={(dir) => move(idx, dir)}
                onDuplicate={() => duplicate(idx)}
                onRemove={() => remove(idx)}
              >
                <BlockRenderer
                  block={b}
                  isActive={b.id === activeId}
                  onChange={(n) => replaceBlock(b.id, n)}
                  onTransform={(replacement) => replaceWith(b.id, replacement)}
                  onInsertAfter={(blk) => insertAt(idx + 1, blk)}
                  onDeleteEmpty={() => {
                    if (blocks.length > 1) remove(idx);
                  }}
                />
              </SortableBlockItem>
              <BlockInserter onInsert={(blk) => insertAt(idx + 1, blk)} />
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface RendererProps {
  block: Block;
  isActive: boolean;
  onChange: (n: Block) => void;
  onTransform: (replacement: Block[]) => void;
  onInsertAfter: (b: Block) => void;
  onDeleteEmpty: () => void;
}

function BlockRenderer({ block, isActive, onChange, onTransform, onInsertAfter, onDeleteEmpty }: RendererProps) {
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
        />
      );
    case "heading":   return <HeadingBlock block={block} onChange={onChange} />;
    case "image":     return <ImageBlock block={block} onChange={onChange} />;
    case "list":      return <ListBlockEdit block={block} onChange={onChange} />;
    case "quote":     return <QuoteBlock block={block} onChange={onChange} />;
    case "code":      return <CodeBlock block={block} onChange={onChange} />;
    case "embed":     return <EmbedBlock block={block} onChange={onChange} />;
    case "video":     return <VideoBlock block={block} onChange={onChange} />;
    case "gallery":   return <GalleryBlock block={block} onChange={onChange} />;
    case "separator": return <SeparatorBlock block={block} onChange={onChange} />;
    case "callout":   return <CalloutBlock block={block} onChange={onChange} />;
    case "table":     return <TableBlockEdit block={block} onChange={onChange} />;
    case "button":    return <ButtonBlock block={block} onChange={onChange} />;
    case "columns":   return <ColumnsBlock block={block} onChange={onChange} />;
    case "html":      return <HtmlBlock block={block} onChange={onChange} />;
    case "review":    return <ReviewBlock block={block} onChange={onChange} />;
    case "proscons":  return <ProsConsBlock block={block} onChange={onChange} />;
    case "spoiler":   return <SpoilerBlock block={block} onChange={onChange} />;
    case "faq":       return <FaqBlock block={block} onChange={onChange} />;
    case "toc":       return <TocBlock block={block} onChange={onChange} />;
    case "newsletter": return <NewsletterBlock block={block} onChange={onChange} />;
    case "affiliate": return <AffiliateBlock block={block} onChange={onChange} />;
    case "xquote":    return <XQuoteBlock block={block} onChange={onChange} />;
    case "compare":   return <CompareBlock block={block} onChange={onChange} />;
    case "login-form":         return <LoginFormBlock block={block} onChange={onChange} />;
    case "register-form":      return <RegisterFormBlock block={block} onChange={onChange} />;
    case "lost-password-form": return <LostPasswordFormBlock block={block} onChange={onChange} />;
    case "reset-password-form": return <ResetPasswordFormBlock block={block} onChange={onChange} />;
    case "audio":        return <AudioBlock block={block} onChange={onChange} />;
    case "cover":        return <CoverBlock block={block} onChange={onChange} />;
    case "file":         return <FileBlock block={block} onChange={onChange} />;
    case "media-text":   return <MediaTextBlock block={block} onChange={onChange} />;
    case "group":        return <GroupBlock block={block} onChange={onChange} />;
    case "spacer":       return <SpacerBlock block={block} onChange={onChange} />;
    case "page-break":   return <PageBreakBlock />;
    case "read-more":    return <ReadMoreBlock block={block} onChange={onChange} />;
    case "pullquote":    return <PullquoteBlock block={block} onChange={onChange} />;
    case "preformatted": return <PreformattedBlock block={block} onChange={onChange} />;
    case "verse":        return <VerseBlock block={block} onChange={onChange} />;
    case "details":      return <DetailsBlock block={block} onChange={onChange} />;
    default:
      return (
        <div className="text-xs text-muted-foreground italic py-2">
          [{block.type}]
        </div>
      );
  }
}
