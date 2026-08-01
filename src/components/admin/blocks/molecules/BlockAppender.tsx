// Dolny appender jak w WordPressie: wiersz-zachęta „Wpisz / aby wybrać blok"
// (klik = nowy akapit z karetką, w nim działa `/`) + przycisk „+" otwierający
// szybki inserter. Używany pod ostatnim blokiem ORAZ jako stan pustego
// dokumentu - dokładnie jak appender Gutenberga.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Block } from "@/lib/blocks/types";
import { Plus } from "@/lib/lucide-shim";
import { BlockInserter } from "../BlockInserter";

interface Props {
  /** Klik w zachętę - nowy pusty akapit (fokus ustawia wołający). */
  onAppendParagraph: () => void;
  /** Wybór z insertera - wstawienie wskazanego bloku. */
  onInsert: (block: Block) => void;
}

export function BlockAppender({ onAppendParagraph, onInsert }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 pl-8 pr-3">
      {open ? (
        <BlockInserter
          variant="controlled"
          open
          autoFocus
          onOpenChange={setOpen}
          onInsert={(b) => {
            setOpen(false);
            onInsert(b);
          }}
        />
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAppendParagraph}
            className="flex-1 text-left py-2 text-sm text-muted-foreground/60 cursor-text select-none"
          >
            {t("blocks.slash.hint")}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("blocks.addBlock")}
            className="w-6 h-6 shrink-0 rounded bg-foreground text-background flex items-center justify-center shadow hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
