// Akapit oparty na TipTap z obsługą:
// - inline formatting (bold, italic, code, link)
// - markdown shortcuts (## , > , - , 1. , --- , ``` ) -> transformacja w inny blok
// - slash command (`/` na pustej linii -> otwiera inserter)
// - Enter na pustym akapicie -> nowy akapit poniżej
// - Backspace na pustym akapicie -> usuwa blok i przenosi focus

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Block } from "@/lib/blocks/types";
import { newBlockId } from "@/lib/blocks/types";
import { detectMarkdownShortcut, htmlToPlain, shortcutToBlock } from "@/lib/blocks/markdown";
import { WordStyleToolbar } from "../WordStyleToolbar";
import { BlockInserter } from "../BlockInserter";

interface Props {
  block: Block;
  isActive: boolean;
  onChange: (next: Block) => void;
  onTransform?: (replacement: Block[]) => void;
  onInsertAfter?: (block: Block) => void;
  onDeleteEmpty?: () => void;
}

export function ParagraphBlock({
  block,
  onChange,
  isActive,
  onTransform,
  onInsertAfter,
  onDeleteEmpty,
}: Props) {
  const { t } = useTranslation();
  const html = String(block.data.html ?? "");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handlersRef = useRef({ onTransform, onInsertAfter, onDeleteEmpty });
  handlersRef.current = { onTransform, onInsertAfter, onDeleteEmpty };

  const [slashOpen, setSlashOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "underline text-primary" } }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Subscript,
      Superscript,
    ],
    content: html || "<p></p>",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none outline-none min-h-[1.5em] focus:outline-none",
      },
      handleKeyDown: (_view, event) => {
        const ed = editor;
        if (!ed) return false;

        // Slash command on empty paragraph
        if (event.key === "/" && ed.isEmpty) {
          event.preventDefault();
          setSlashOpen(true);
          return true;
        }

        // Enter -> new paragraph below when empty (otherwise default split is fine for inline)
        if (event.key === "Enter" && !event.shiftKey) {
          const isEmpty = ed.isEmpty;
          if (isEmpty && handlersRef.current.onInsertAfter) {
            event.preventDefault();
            const newP: Block = { id: newBlockId(), type: "paragraph", data: { html: "" } };
            handlersRef.current.onInsertAfter(newP);
            return true;
          }
        }

        // Backspace at start of empty paragraph -> delete block
        if (event.key === "Backspace" && ed.isEmpty && handlersRef.current.onDeleteEmpty) {
          event.preventDefault();
          handlersRef.current.onDeleteEmpty();
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = ed.getHTML();
      onChangeRef.current({ ...block, data: { ...block.data, html: next } });

      // Markdown shortcuts: detect when user typed e.g. "## " on an otherwise plain line.
      const plain = htmlToPlain(next);
      if (/[\s>`\-*.]\s*$/.test(plain) || /^---\s*$/.test(plain) || /^```\s*$/.test(plain)) {
        const transform = detectMarkdownShortcut(plain);
        if (transform && handlersRef.current.onTransform) {
          handlersRef.current.onTransform([shortcutToBlock(transform)]);
        }
      }
    },
  });

  // Sync external content changes (undo/redo, programmatic transforms)
  useEffect(() => {
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html || "<p></p>", { emitUpdate: false });
    }
  }, [html, editor]);

  if (!editor) return null;

  return (
    <div className="relative">
      {isActive && !slashOpen && <WordStyleToolbar editor={editor} />}

      <EditorContent editor={editor} />

      {editor.isEmpty && isActive && !slashOpen && (
        <p className="pointer-events-none absolute inset-0 text-muted-foreground/60 text-sm select-none italic">
          {t("blocks.slash.hint")}
        </p>
      )}

      {slashOpen && handlersRef.current.onTransform && (
        <BlockInserter
          variant="controlled"
          open
          autoFocus
          onOpenChange={(v) => {
            setSlashOpen(v);
            if (!v) editor.commands.focus();
          }}
          onInsert={(blk) => {
            setSlashOpen(false);
            handlersRef.current.onTransform?.([blk]);
          }}
        />
      )}
    </div>
  );
}
