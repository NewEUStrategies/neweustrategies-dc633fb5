// Nagłówek (H1-H5) w CMS builderze - edycja przez TipTap, dzięki czemu działa
// pogrubienie / kursywa / kolor zaznaczenia (toolbar widgetu), a treść jest
// renderowana w PRAWDZIWYM znaczniku `.cms-h{level}`, więc podgląd bierze
// globalne rozmiary fontów z panelu admina (--fs-h1…--fs-h6) dokładnie tak
// samo jak strona publiczna.
import { useEditor, EditorContent } from "@tiptap/react";
import { getHTMLFromFragment } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { useEffect, useRef } from "react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { newBlockId } from "@/lib/blocks/types";
import type { SelectionDirection } from "@/lib/blocks/crossSelection";
import { safeCssColor, stripParagraphWrapper, toParagraphDoc } from "@/lib/blocks/inlineHtml";
import { reapplyPendingBlockFocus } from "@/lib/blocks/focus";
import { looksLikeRichPaste, parseWordHtml, parseWordInlineHtml } from "@/lib/blocks/wordPaste";
import { HeadingWidgetToolbar } from "../HeadingWidgetToolbar";

interface Props {
  block: Block;
  isActive?: boolean;
  onChange: (next: Block) => void;
  onTransform?: (replacement: Block[]) => void;
  onInsertAfter?: (block: Block) => void;
  onDeleteEmpty?: () => void;
  /** Backspace na początku niepustego nagłówka - scalenie z poprzednim (WP). */
  onMergeWithPrevious?: () => boolean;
  /** Strzałka w górę/lewo na początku treści - fokus na poprzedni blok. */
  onFocusPrevious?: () => boolean;
  /** Strzałka w dół/prawo na końcu treści - fokus na następny blok. */
  onFocusNext?: () => boolean;
  /** Ctrl/Cmd+A przy już zaznaczonej całej treści bloku - eskalacja do dokumentu. */
  onSelectAllBlocks?: () => void;
  /** Shift+strzałka na krawędzi treści - zaznaczenie w poprzek bloków (WP). */
  onExtendBlockSelection?: (dir: SelectionDirection) => boolean;
}

export function HeadingBlock({
  block,
  isActive,
  onChange,
  onTransform,
  onInsertAfter,
  onDeleteEmpty,
  onMergeWithPrevious,
  onFocusPrevious,
  onFocusNext,
  onSelectAllBlocks,
  onExtendBlockSelection,
}: Props) {
  const bt = useBlocksI18n();
  const level = Math.min(Math.max(Number(block.data.level ?? 2), 1), 5);
  const text = String(block.data.text ?? "");
  const align = String(block.data.align ?? "left");
  const color = safeCssColor(block.data.color);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handlersRef = useRef({
    onTransform,
    onInsertAfter,
    onDeleteEmpty,
    onMergeWithPrevious,
    onFocusPrevious,
    onFocusNext,
    onSelectAllBlocks,
    onExtendBlockSelection,
  });
  handlersRef.current = {
    onTransform,
    onInsertAfter,
    onDeleteEmpty,
    onMergeWithPrevious,
    onFocusPrevious,
    onFocusNext,
    onSelectAllBlocks,
    onExtendBlockSelection,
  };
  const blockRef = useRef(block);
  blockRef.current = block;

  const alignClass =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color,
      Superscript,
      Subscript,
    ],
    content: toParagraphDoc(text),
    editorProps: {
      attributes: {
        class: "outline-none focus:outline-none min-h-[1em]",
        "data-inline": "true",
      },
      handlePaste: (_view, event) => {
        const rich = event.clipboardData?.getData("text/html") ?? "";
        if (!looksLikeRichPaste(rich)) return false;
        const ed = editor;
        const transform = handlersRef.current.onTransform;
        const blocks = parseWordHtml(rich);
        // Wklejenie wielu bloków z Worda w nagłówek: pierwszy fragment zostaje
        // nagłówkiem, reszta staje się osobnymi blokami (Word-like).
        if (transform && blocks.length > 1) {
          event.preventDefault();
          transform([blockRef.current, ...blocks.slice(blocks[0]?.type === "heading" ? 1 : 0)]);
          return true;
        }
        const inline = parseWordInlineHtml(rich);
        if (!inline || !ed) return false;
        event.preventDefault();
        ed.commands.insertContent(inline);
        return true;
      },
      handleKeyDown: (view, event) => {
        const ed = editor;
        if (!ed) return false;

        // Ctrl/Cmd+A: pierwsze naciśnięcie zaznacza treść nagłówka, drugie
        // (gdy już wszystko zaznaczone) - wszystkie bloki dokumentu, jak w Word.
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
          const { from, to } = ed.state.selection;
          const docSize = ed.state.doc.content.size;
          if (from <= 1 && to >= docSize - 1 && handlersRef.current.onSelectAllBlocks) {
            event.preventDefault();
            ed.commands.blur();
            handlersRef.current.onSelectAllBlocks();
            return true;
          }
          return false;
        }

        // Shift+strzałka na krawędzi treści -> ESKALACJA do zaznaczenia
        // BLOKOWEGO w poprzek bloków (parytet z WP).
        if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const extend = handlersRef.current.onExtendBlockSelection;
          if (extend) {
            const sel = ed.state.selection;
            const atDocStart = sel.from <= 1;
            const atDocEnd = sel.to >= ed.state.doc.content.size - 1;
            const back =
              (event.key === "ArrowUp" && view.endOfTextblock("up")) ||
              (event.key === "ArrowLeft" && atDocStart);
            const forward =
              (event.key === "ArrowDown" && view.endOfTextblock("down")) ||
              (event.key === "ArrowRight" && atDocEnd);
            if ((back && extend(-1)) || (forward && extend(1))) {
              event.preventDefault();
              return true;
            }
          }
        }

        // Strzałki na krawędziach treści -> sąsiedni blok (płynne pisanie WP).
        if (!event.shiftKey && ed.state.selection.empty) {
          const sel = ed.state.selection;
          const handlers = handlersRef.current;
          const atDocStart = sel.from <= 1;
          const atDocEnd = sel.to >= ed.state.doc.content.size - 1;
          if (
            handlers.onFocusPrevious &&
            ((event.key === "ArrowUp" && view.endOfTextblock("up")) ||
              (event.key === "ArrowLeft" && atDocStart))
          ) {
            if (handlers.onFocusPrevious()) {
              event.preventDefault();
              return true;
            }
          }
          if (
            handlers.onFocusNext &&
            ((event.key === "ArrowDown" && view.endOfTextblock("down")) ||
              (event.key === "ArrowRight" && atDocEnd))
          ) {
            if (handlers.onFocusNext()) {
              event.preventDefault();
              return true;
            }
          }
        }

        // Enter -> podział jak w WP: treść za kursorem przechodzi do NOWEGO
        // akapitu pod nagłówkiem, nagłówek zatrzymuje część przed kursorem.
        if (event.key === "Enter" && !event.shiftKey && handlersRef.current.onInsertAfter) {
          event.preventDefault();
          const { state } = ed;
          const { from, to } = state.selection;
          const end = state.doc.content.size;
          const tailFragment = state.doc.slice(to, end).content;
          const tailHtml = getHTMLFromFragment(tailFragment, state.schema);
          const tail = /^\s*(<p>(\s|<br\s*\/?>)*<\/p>)?\s*$/i.test(tailHtml) ? "" : tailHtml;
          if (from < end) ed.chain().focus().deleteRange({ from, to: end }).run();
          handlersRef.current.onInsertAfter({
            id: newBlockId(),
            type: "paragraph",
            data: { html: tail },
          });
          return true;
        }

        if (event.key === "Backspace" && ed.isEmpty && handlersRef.current.onDeleteEmpty) {
          event.preventDefault();
          handlersRef.current.onDeleteEmpty();
          return true;
        }

        // Backspace na POCZĄTKU niepustego nagłówka -> scal z poprzednim.
        if (
          event.key === "Backspace" &&
          !ed.isEmpty &&
          ed.state.selection.empty &&
          ed.state.selection.from <= 1 &&
          handlersRef.current.onMergeWithPrevious
        ) {
          if (handlersRef.current.onMergeWithPrevious()) {
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = stripParagraphWrapper(ed.getHTML());
      const current = blockRef.current;
      onChangeRef.current({ ...current, data: { ...current.data, text: next } });
    },
  });

  // Po synchronizacji treści przywracamy oczekujący fokus (scalenie/undo) -
  // `setContent` mapuje selekcję na koniec dokumentu.
  useEffect(() => {
    if (editor && text !== stripParagraphWrapper(editor.getHTML())) {
      editor.commands.setContent(toParagraphDoc(text), { emitUpdate: false });
      reapplyPendingBlockFocus(block.id);
    }
  }, [text, editor, block.id]);

  if (!editor) return null;

  const isEmpty = editor.isEmpty;

  return (
    <div className="relative">
      {isActive && <HeadingWidgetToolbar block={block} onChange={onChange} editor={editor} />}
      <div
        className={`cms-h${level} ${alignClass} relative`}
        style={color ? { color } : undefined}
        data-heading-level={level}
      >
        <EditorContent editor={editor} data-block-editable="true" />
        {isEmpty && (
          <span className="pointer-events-none absolute inset-0 select-none opacity-40">
            {bt.editor("heading", "placeholder", { level })}
          </span>
        )}
      </div>
    </div>
  );
}
