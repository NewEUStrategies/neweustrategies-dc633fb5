// Akapit oparty na TipTap z obsługą (parytet z WordPress Gutenberg):
// - inline formatting (bold, italic, code, link)
// - markdown shortcuts (## , > , - , 1. , --- , ``` ) -> transformacja w inny blok
// - slash command (`/` na pustej linii -> otwiera inserter)
// - Enter -> podział bloku (ogon za kursorem przechodzi do nowego akapitu)
// - Backspace na pustym akapicie -> usuwa blok i przenosi focus
// - Backspace na POCZĄTKU niepustego akapitu -> scala z poprzednim blokiem
// - strzałki na krawędziach treści -> płynne przejście do sąsiedniego bloku

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
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Block } from "@/lib/blocks/types";
import { newBlockId } from "@/lib/blocks/types";
import type { SelectionDirection } from "@/lib/blocks/crossSelection";
import { detectMarkdownShortcut, htmlToPlain, shortcutToBlock } from "@/lib/blocks/markdown";
import { looksLikeRichPaste, parseWordHtml, parseWordInlineHtml } from "@/lib/blocks/wordPaste";
import { parseBlocksFromClipboard } from "@/lib/blocks/clipboard";
import { filesToImageBlocks } from "@/lib/blocks/imagePaste";
import { reapplyPendingBlockFocus } from "@/lib/blocks/focus";
import { parseSlashQuery, searchBlockSpecs } from "@/lib/blocks/search";

import { WordStyleToolbar } from "../WordStyleToolbar";
import { SlashMenu } from "../molecules/SlashMenu";

interface Props {
  block: Block;
  isActive: boolean;
  onChange: (next: Block) => void;
  onTransform?: (replacement: Block[]) => void;
  onInsertAfter?: (block: Block) => void;
  onDeleteEmpty?: () => void;
  /** Backspace na początku niepustego bloku - scalenie z poprzednim (WP). */
  onMergeWithPrevious?: () => boolean;
  /** Strzałka w górę/lewo na początku treści - fokus na poprzedni blok. */
  onFocusPrevious?: () => boolean;
  /** Strzałka w dół/prawo na końcu treści - fokus na następny blok. */
  onFocusNext?: () => boolean;
  /** Ctrl/Cmd+A przy zaznaczonej całej treści bloku - eskalacja do dokumentu. */
  onSelectAllBlocks?: () => void;
  /** Shift+strzałka na krawędzi treści - zaznaczenie w poprzek bloków (WP). */
  onExtendBlockSelection?: (dir: SelectionDirection) => boolean;
}

export function ParagraphBlock({
  block,
  onChange,
  isActive,
  onTransform,
  onInsertAfter,
  onDeleteEmpty,
  onMergeWithPrevious,
  onFocusPrevious,
  onFocusNext,
  onSelectAllBlocks,
  onExtendBlockSelection,
}: Props) {
  const { t } = useTranslation();
  const html = String(block.data.html ?? "");
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

  // Menu slash 1:1 z WP: "/" pisze się do akapitu, dalszy tekst filtruje listę.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIdx, setSlashIdx] = useState(0);
  const slashSpecs = useMemo(
    () => searchBlockSpecs(slashQuery, (type) => t(`blocks.types.${type}`)).slice(0, 9),
    [slashQuery, t],
  );
  // handleKeyDown/onUpdate TipTapa to closure'y z montowania - czytaja refy.
  const slashRef = useRef({ open: slashOpen, idx: slashIdx, specs: slashSpecs });
  slashRef.current = { open: slashOpen, idx: slashIdx, specs: slashSpecs };
  const closeSlash = () => {
    setSlashOpen(false);
    setSlashQuery("");
    setSlashIdx(0);
  };

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

      handleKeyDown: (view, event) => {
        const ed = editor;
        if (!ed) return false;

        // Slash command: "/" na pustym akapicie OTWIERA menu, ale znak
        // normalnie trafia do treści - dalsze pisanie filtruje liste (WP).
        if (event.key === "/" && ed.isEmpty && !slashRef.current.open) {
          setSlashOpen(true);
          setSlashQuery("");
          setSlashIdx(0);
          return false;
        }

        // Otwarte menu slash przejmuje strzalki/Enter/Escape.
        if (slashRef.current.open) {
          const { idx, specs } = slashRef.current;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSlashIdx(Math.min(idx + 1, Math.max(specs.length - 1, 0)));
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSlashIdx(Math.max(idx - 1, 0));
            return true;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            const spec = specs[idx] ?? specs[0];
            if (spec && handlersRef.current.onTransform) {
              closeSlash();
              handlersRef.current.onTransform([spec.create()]);
            }
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            closeSlash(); // tekst "/zapytanie" zostaje w akapicie - parytet z WP
            return true;
          }
        }

        // Shift+strzałka na krawędzi treści -> ESKALACJA do zaznaczenia
        // BLOKOWEGO (parytet z WP: zaznaczenie tekstowe nie potrafi przejść
        // granicy bloku, więc od granicy zaznaczamy CAŁE bloki).
        if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const extend = handlersRef.current.onExtendBlockSelection;
          if (extend) {
            const sel = ed.state.selection;
            const inFirstChild = sel.$from.index(0) === 0;
            const inLastChild = sel.$to.index(0) === ed.state.doc.childCount - 1;
            const atDocStart = sel.from <= 1;
            const atDocEnd = sel.to >= ed.state.doc.content.size - 1;
            const back =
              (event.key === "ArrowUp" && inFirstChild && view.endOfTextblock("up")) ||
              (event.key === "ArrowLeft" && atDocStart);
            const forward =
              (event.key === "ArrowDown" && inLastChild && view.endOfTextblock("down")) ||
              (event.key === "ArrowRight" && atDocEnd);
            if ((back && extend(-1)) || (forward && extend(1))) {
              event.preventDefault();
              return true;
            }
          }
        }

        // Strzałki na krawędziach treści -> sąsiedni blok (pisanie płynie
        // przez cały dokument jak w WP). `endOfTextblock` respektuje realne
        // linie wizualne (zawijanie, bidi), a indeks dziecka pilnuje, żeby
        // wewnętrzne akapity bloku nie wyrzucały kursora przedwcześnie.
        if (!event.shiftKey && ed.state.selection.empty) {
          const sel = ed.state.selection;
          const handlers = handlersRef.current;
          const inFirstChild = sel.$from.index(0) === 0;
          const inLastChild = sel.$to.index(0) === ed.state.doc.childCount - 1;
          const atDocStart = sel.from <= 1;
          const atDocEnd = sel.to >= ed.state.doc.content.size - 1;
          if (
            handlers.onFocusPrevious &&
            ((event.key === "ArrowUp" && inFirstChild && view.endOfTextblock("up")) ||
              (event.key === "ArrowLeft" && atDocStart))
          ) {
            if (handlers.onFocusPrevious()) {
              event.preventDefault();
              return true;
            }
          }
          if (
            handlers.onFocusNext &&
            ((event.key === "ArrowDown" && inLastChild && view.endOfTextblock("down")) ||
              (event.key === "ArrowRight" && atDocEnd))
          ) {
            if (handlers.onFocusNext()) {
              event.preventDefault();
              return true;
            }
          }
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

        // Backspace na POCZĄTKU niepustego akapitu -> scal z poprzednim
        // blokiem; karetka ląduje w punkcie złączenia (WP-flow).
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
      const next = ed.getHTML();
      onChangeRef.current({ ...block, data: { ...block.data, html: next } });

      const plain = htmlToPlain(next);

      // Menu slash: dalszy tekst po "/" filtruje liste; spacja / usuniecie
      // "/" / drugi "/" zamyka menu (uzytkownik pisze zwykla tresc).
      if (slashRef.current.open) {
        const q = parseSlashQuery(plain);
        if (q === null) closeSlash();
        else {
          setSlashQuery(q);
          setSlashIdx(0);
        }
      }

      // Markdown shortcuts: detect when user typed e.g. "## " on an otherwise plain line.
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
    const imageBlocks = await filesToImageBlocks(files);
    if (!imageBlocks.length) return;
    const current = blockRef.current;
    const keepCurrent = !ed.isEmpty;
    transform(
      keepCurrent
        ? [{ ...current, data: { ...current.data, html: ed.getHTML() } }, ...imageBlocks]
        : imageBlocks,
    );
  }

  // Dezaktywacja bloku (klik gdzie indziej) zamyka menu slash.
  useEffect(() => {
    if (!isActive && slashOpen) closeSlash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // Sync external content changes (undo/redo, programmatic transforms).
  // `setContent` mapuje selekcję na koniec dokumentu - po synchronizacji
  // przywracamy ewentualny oczekujący fokus (np. karetkę w punkcie scalenia).
  useEffect(() => {
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html || "<p></p>", { emitUpdate: false });
      reapplyPendingBlockFocus(block.id);
    }
  }, [html, editor, block.id]);

  if (!editor) return null;

  return (
    <div className="relative">
      {isActive && !slashOpen && <WordStyleToolbar editor={editor} />}

      <EditorContent editor={editor} data-block-editable="true" />

      {editor.isEmpty && isActive && !slashOpen && (
        <p className="pointer-events-none absolute inset-0 text-muted-foreground/60 text-sm select-none italic">
          {t("blocks.slash.hint")}
        </p>
      )}

      {slashOpen && handlersRef.current.onTransform && (
        <SlashMenu
          specs={slashSpecs}
          activeIndex={Math.min(slashIdx, Math.max(slashSpecs.length - 1, 0))}
          onHover={setSlashIdx}
          onPick={(spec) => {
            closeSlash();
            handlersRef.current.onTransform?.([spec.create()]);
          }}
        />
      )}
    </div>
  );
}
