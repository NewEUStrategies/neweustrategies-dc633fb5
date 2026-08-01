// Akapit oparty na TipTap z obsługą:
// - inline formatting (bold, italic, code, link)
// - markdown shortcuts (## , > , - , 1. , --- , ``` ) -> transformacja w inny blok
// - slash command (`/` na pustej linii -> otwiera inserter)
// - Enter na pustym akapicie -> nowy akapit poniżej
// - Backspace na pustym akapicie -> usuwa blok i przenosi focus

import { useEditor, EditorContent } from "@tiptap/react";
import { getHTMLFromFragment } from "@tiptap/core";
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
import { looksLikeRichPaste, parseWordHtml, parseWordInlineHtml } from "@/lib/blocks/wordPaste";
import { parseBlocksFromClipboard } from "@/lib/blocks/clipboard";

import { WordStyleToolbar } from "../WordStyleToolbar";
import { BlockInserter } from "../BlockInserter";

interface Props {
  block: Block;
  isActive: boolean;
  onChange: (next: Block) => void;
  onTransform?: (replacement: Block[]) => void;
  onInsertAfter?: (block: Block) => void;
  onDeleteEmpty?: () => void;
  /** Ctrl/Cmd+A przy zaznaczonej całej treści bloku - eskalacja do dokumentu. */
  onSelectAllBlocks?: () => void;
}

export function ParagraphBlock({
  block,
  onChange,
  isActive,
  onTransform,
  onInsertAfter,
  onDeleteEmpty,
  onSelectAllBlocks,
}: Props) {
  const { t } = useTranslation();
  const html = String(block.data.html ?? "");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handlersRef = useRef({ onTransform, onInsertAfter, onDeleteEmpty, onSelectAllBlocks });
  handlersRef.current = { onTransform, onInsertAfter, onDeleteEmpty, onSelectAllBlocks };
  const blockRef = useRef(block);
  blockRef.current = block;

  const [slashOpen, setSlashOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "underline text-foreground" },
      }),
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
        class:
          "prose prose-sm dark:prose-invert max-w-none outline-none min-h-[1.5em] focus:outline-none",
      },
      // Wklejanie (kolejność jak w Gutenbergu):
      //   1. payload blokowy - nasz sentinel albo markup `<!-- wp:… -->`
      //      skopiowany z WordPressa - odtwarza bloki 1:1,
      //   2. pliki graficzne ze schowka (zrzut ekranu / "kopiuj obraz")
      //      -> bloki obrazów (upload do biblioteki mediów przy zapisie),
      //   3. Word / Google Docs: zachowujemy strukturę (nagłówki, listy,
      //      tabele, cytaty, entery), przypisy dolne -> shortcode [fn]…[/fn].
      handlePaste: (_view, event) => {
        const rich = event.clipboardData?.getData("text/html") ?? "";
        const plain = event.clipboardData?.getData("text/plain") ?? "";
        const ed = editor;
        const transform = handlersRef.current.onTransform;

        const blockPayload = parseBlocksFromClipboard(rich, plain);
        if (blockPayload?.length && transform && ed) {
          event.preventDefault();
          const current = blockRef.current;
          const keepCurrent = !ed.isEmpty;
          transform(
            keepCurrent
              ? [{ ...current, data: { ...current.data, html: ed.getHTML() } }, ...blockPayload]
              : blockPayload,
          );
          return true;
        }

        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length && transform && ed) {
          event.preventDefault();
          void pasteImagesAsBlocks(files);
          return true;
        }

        if (!looksLikeRichPaste(rich)) return false;
        const blocks = parseWordHtml(rich);
        if (!blocks.length) return false;
        const singleParagraph =
          blocks.length === 1 && blocks[0].type === "paragraph" ? blocks[0] : null;
        if (singleParagraph || !transform || !ed) {
          const inline = singleParagraph
            ? String(singleParagraph.data.html ?? "")
            : parseWordInlineHtml(rich);
          if (!inline) return false;
          event.preventDefault();
          ed?.commands.insertContent(inline);
          return true;
        }
        event.preventDefault();
        const keepCurrent = !ed.isEmpty;
        const current = blockRef.current;
        transform(
          keepCurrent
            ? [{ ...current, data: { ...current.data, html: ed.getHTML() } }, ...blocks]
            : blocks,
        );
        return true;
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

        // Ctrl/Cmd+A: jak w Word - pierwsze naciśnięcie zaznacza treść bloku,
        // drugie (gdy blok jest już cały zaznaczony) zaznacza WSZYSTKIE bloki.
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

        // Enter -> ZAWSZE nowy blok poniżej (zachowanie Worda / Gutenberga).
        // Treść za kursorem przenosi się do nowego bloku, treść przed nim
        // zostaje w bieżącym. Shift+Enter nadal robi miękki <br>.
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

  /** Pliki graficzne ze schowka -> bloki obrazów za bieżącym akapitem. */
  async function pasteImagesAsBlocks(files: File[]): Promise<void> {
    const ed = editor;
    const transform = handlersRef.current.onTransform;
    if (!ed || !transform) return;
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
        // nieczytelny plik nie przerywa wklejki pozostałych
      }
    }
    if (!imageBlocks.length) return;
    const current = blockRef.current;
    const keepCurrent = !ed.isEmpty;
    transform(
      keepCurrent
        ? [{ ...current, data: { ...current.data, html: ed.getHTML() } }, ...imageBlocks]
        : imageBlocks,
    );
  }

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
