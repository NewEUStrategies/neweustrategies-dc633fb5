// Widok kodu dokumentu (odpowiednik "Edytora kodu" z WP): markup Gutenberga
// całego wpisu w aktywnym języku - do podglądu i skopiowania. Dzięki temu
// treść jest w 100% przenośna: wklejenie tego markupu do WordPressa (lub
// z powrotem do naszej kanwy) odtwarza bloki.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BlocksDoc } from "@/lib/blocks/types";
import { blocksToGutenberg } from "@/lib/blocks/gutenberg";
import { Check, Copy } from "@/lib/lucide-shim";

interface Props {
  doc: BlocksDoc;
  /** Język aktywnego dokumentu - wyłącznie do opisu w nagłówku dialogu. */
  lang: "pl" | "en";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CodeViewDialog({ doc, lang, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const markup = useMemo(() => (open ? blocksToGutenberg(doc) : ""), [open, doc]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markup);
      setCopied(true);
      toast.success(t("blocks.codeView.copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("blocks.codeView.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("blocks.codeView.title")}</DialogTitle>
          <DialogDescription>
            {t("blocks.codeView.desc", {
              lang: lang.toUpperCase(),
              count: doc.blocks.length,
            })}
          </DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          value={markup}
          spellCheck={false}
          aria-label={t("blocks.codeView.title")}
          className="w-full h-[50vh] resize-none rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-foreground"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t("blocks.codeView.blockCount", {
              count: doc.blocks.length,
            })}
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {t("blocks.codeView.copy")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
