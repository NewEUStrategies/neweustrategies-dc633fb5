// Nagłówek (H1-H5) w CMS builderze - edycja przez TipTap, dzięki czemu działa
// pogrubienie / kursywa / kolor zaznaczenia (toolbar widgetu), a treść jest
// renderowana w PRAWDZIWYM znaczniku `.cms-h{level}`, więc podgląd bierze
// globalne rozmiary fontów z panelu admina (--fs-h1…--fs-h6) dokładnie tak
// samo jak strona publiczna.
import { useEditor, EditorContent } from "@tiptap/react";
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
import { safeCssColor, stripParagraphWrapper, toParagraphDoc } from "@/lib/blocks/inlineHtml";
import { looksLikeRichPaste, parseWordHtml, parseWordInlineHtml } from "@/lib/blocks/wordPaste";
import { HeadingWidgetToolbar } from "../HeadingWidgetToolbar";

interface Props {
  block: Block;
  isActive?: boolean;
  onChange: (next: Block) => void;
  onTransform?: (replacement: Block[]) => void;
  onInsertAfter?: (block: Block) => void;
  onDeleteEmpty?: () => void;
  /** Ctrl/Cmd+A przy już zaznaczonej całej treści bloku - eskalacja do dokumentu. */
  onSelectAllBlocks?: () => void;
}

export function HeadingBlock({
  block,
  isActive,
  onChange,
  onTransform,
  onInsertAfter,
  onDeleteEmpty,
  onSelectAllBlocks,
}: Props) {
  const bt = useBlocksI18n();
  const level = Math.min(Math.max(Number(block.data.level ?? 2), 1), 5);
  const text = String(block.data.text ?? "");
  const align = String(block.data.align ?? "left");
  const color = safeCssColor(block.data.color);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handlersRef = useRef({ onTransform, onInsertAfter, onDeleteEmpty, onSelectAllBlocks });
  handlersRef.current = { onTransform, onInsertAfter, onDeleteEmpty, onSelectAllBlocks };
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
      handleKeyDown: (_view, event) => {
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

        // Enter -> nowy blok (akapit) poniżej nagłówka.
        if (event.key === "Enter" && !event.shiftKey && handlersRef.current.onInsertAfter) {
          event.preventDefault();
          handlersRef.current.onInsertAfter({
            id: newBlockId(),
            type: "paragraph",
            data: { html: "" },
          });
          return true;
        }

        if (event.key === "Backspace" && ed.isEmpty && handlersRef.current.onDeleteEmpty) {
          event.preventDefault();
          handlersRef.current.onDeleteEmpty();
          return true;
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

  useEffect(() => {
    if (editor && text !== stripParagraphWrapper(editor.getHTML())) {
      editor.commands.setContent(toParagraphDoc(text), { emitUpdate: false });
    }
  }, [text, editor]);

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
        <EditorContent editor={editor} />
        {isEmpty && (
          <span className="pointer-events-none absolute inset-0 select-none opacity-40">
            {bt.editor("heading", "placeholder", { level })}
          </span>
        )}
      </div>
    </div>
  );
}
