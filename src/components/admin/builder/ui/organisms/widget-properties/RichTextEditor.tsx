// Content editor for the `rich-text` builder widget. Opens the same block
// editor used for article bodies in a modal, bound to the widget's stored
// localized blocks document - so authors compose rich content (callouts, FAQ,
// pros/cons, TOC, embeds, …) without leaving the builder.
import { lazy, Suspense } from "react";
import type { Json } from "@/lib/builder/types";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { FileText } from "@/lib/lucide-shim";
import { PropField } from "../../atoms";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const PostBlockEditor = lazy(() =>
  import("@/components/admin/blocks/PostBlockEditor").then((m) => ({ default: m.PostBlockEditor })),
);

function readLocalized(raw: Json | undefined): LocalizedBlocks | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as unknown as LocalizedBlocks;
}

interface Props {
  c: Record<string, Json>;
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function RichTextEditor({ c, setContent }: Props) {
  const value = readLocalized(c.doc);
  const plCount = value?.pl?.blocks?.length ?? 0;
  const enCount = value?.en?.blocks?.length ?? 0;

  return (
    <PropField label="Treść (bloki)">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="w-full h-8 px-2 text-xs rounded border border-border bg-background hover:bg-accent/40 inline-flex items-center justify-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" />
            Edytuj treść ({plCount} PL / {enCount} EN)
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-[1100px] w-[96vw] h-[86vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-sm">Edytor treści (bloki)</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <Suspense
              fallback={<div className="p-6 text-sm text-muted-foreground">Ładowanie edytora…</div>}
            >
              <PostBlockEditor
                value={value ?? { pl: EMPTY_BLOCKS_DOC, en: EMPTY_BLOCKS_DOC }}
                onChange={(next: LocalizedBlocks) => setContent("doc", next as unknown as Json)}
                documentPane={
                  <div className="p-3 text-xs text-muted-foreground">
                    Treść tego widgetu jest zapisywana w dwóch językach (PL/EN).
                  </div>
                }
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
    </PropField>
  );
}
