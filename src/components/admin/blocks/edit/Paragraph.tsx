import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect, useRef } from "react";
import type { Block } from "@/lib/blocks/types";
import { Bold, Italic, Link as LinkIcon, Code } from "@/lib/lucide-shim";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
  isActive: boolean;
}

export function ParagraphBlock({ block, onChange, isActive }: Props) {
  const html = String(block.data.html ?? "");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "underline text-primary" } }),
    ],
    content: html || "<p></p>",
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none outline-none min-h-[1.5em] focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      const h = editor.getHTML();
      onChangeRef.current({ ...block, data: { ...block.data, html: h } });
    },
  });

  // Sync external changes (np. po undo)
  useEffect(() => {
    if (editor && html && html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [html, editor]);

  if (!editor) return null;

  return (
    <div className="relative">
      {isActive && (
        <div className="absolute -top-9 left-0 z-10 flex items-center gap-1 rounded-md border border-border bg-popover px-1 py-1 shadow">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1 rounded hover:bg-accent ${editor.isActive("bold") ? "bg-accent" : ""}`} title="Bold">
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1 rounded hover:bg-accent ${editor.isActive("italic") ? "bg-accent" : ""}`} title="Italic">
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleCode().run()}
            className={`p-1 rounded hover:bg-accent ${editor.isActive("code") ? "bg-accent" : ""}`} title="Code">
            <Code className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => {
            const url = window.prompt("URL linku:", editor.getAttributes("link").href ?? "https://");
            if (url === null) return;
            if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }} className={`p-1 rounded hover:bg-accent ${editor.isActive("link") ? "bg-accent" : ""}`} title="Link">
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
