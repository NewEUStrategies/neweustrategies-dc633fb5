import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bold, Italic, List, ListOrdered, Heading2, Heading3, Link as LinkIcon, Image as ImageIc, Quote, Undo, Redo } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  mode: "richtext" | "markdown";
  onPickImage?: () => Promise<string | null>;
}

export function PostEditor({ value, onChange, mode, onPickImage }: Props) {
  if (mode === "markdown") return <MarkdownEditor value={value} onChange={onChange} />;
  return <RichEditor value={value} onChange={onChange} onPickImage={onPickImage} />;
}

function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={20} className="font-mono text-sm" />
      <div className="prose dark:prose-invert max-w-none border border-border rounded-md p-4 bg-muted/20 overflow-auto">
        <ReactMarkdown>{value || "*Podgląd...*"}</ReactMarkdown>
      </div>
    </div>
  );
}

function RichEditor({ value, onChange, onPickImage }: { value: string; onChange: (v: string) => void; onPickImage?: () => Promise<string | null> }) {
  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Image],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "prose dark:prose-invert max-w-none min-h-[400px] p-4 focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  const Btn = ({ onClick, active, children, label }: any) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`p-2 rounded hover:bg-muted ${active ? "bg-muted text-brand" : ""}`}
    >
      {children}
    </button>
  );

  return (
    <div className="border border-border rounded-md bg-background">
      <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border">
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label="Bold"><Bold className="w-4 h-4" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label="Italic"><Italic className="w-4 h-4" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} label="H2"><Heading2 className="w-4 h-4" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} label="H3"><Heading3 className="w-4 h-4" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} label="UL"><List className="w-4 h-4" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} label="OL"><ListOrdered className="w-4 h-4" /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} label="Quote"><Quote className="w-4 h-4" /></Btn>
        <Btn
          onClick={() => {
            const url = window.prompt("URL");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
          active={editor.isActive("link")}
          label="Link"
        >
          <LinkIcon className="w-4 h-4" />
        </Btn>
        <Btn
          onClick={async () => {
            const url = onPickImage ? await onPickImage() : window.prompt("Image URL");
            if (url) editor.chain().focus().setImage({ src: url }).run();
          }}
          label="Image"
        >
          <ImageIc className="w-4 h-4" />
        </Btn>
        <div className="ml-auto flex gap-1">
          <Btn onClick={() => editor.chain().focus().undo().run()} label="Undo"><Undo className="w-4 h-4" /></Btn>
          <Btn onClick={() => editor.chain().focus().redo().run()} label="Redo"><Redo className="w-4 h-4" /></Btn>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
