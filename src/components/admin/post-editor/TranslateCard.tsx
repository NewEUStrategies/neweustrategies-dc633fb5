// Karta "Tłumaczenie AI PL -> EN" w edytorze wpisu (B4). Wynik ląduje
// w FORMULARZU (pola *_en + dokument bloków EN) jako niezapisany szkic -
// redakcja weryfikuje i zapisuje świadomie. Serwer nie dotyka bazy.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Languages, Loader2 } from "lucide-react";
import { translatePostDraft } from "@/lib/content/translate.functions";
import type { TranslateOutput } from "@/lib/content/translateSegments";
import type { Block } from "@/lib/blocks/types";
import { Button } from "@/components/ui/button";
import "@/lib/i18n-admin-post-panes";

export interface TranslateCardInput {
  title_pl: string;
  excerpt_pl: string | null;
  takeaways_pl: string[];
  seo_title_pl: string | null;
  seo_description_pl: string | null;
  content_pl: string | null;
  blocks_pl: Block[] | null;
}

export function TranslateCard({
  source,
  hasEnContent,
  onTranslated,
}: {
  source: TranslateCardInput;
  /** Czy istnieje już treść EN (ostrzeżenie o nadpisaniu szkicu w formularzu). */
  hasEnContent: boolean;
  onTranslated: (result: TranslateOutput) => void;
}) {
  const { t } = useTranslation();
  const translate$ = useServerFn(translatePostDraft);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await translate$({
        data: {
          title_pl: source.title_pl,
          excerpt_pl: source.excerpt_pl,
          takeaways_pl: source.takeaways_pl,
          seo_title_pl: source.seo_title_pl,
          seo_description_pl: source.seo_description_pl,
          content_pl: source.content_pl,
          blocks_doc_pl: source.blocks_pl ? { version: 1, blocks: source.blocks_pl } : null,
        },
      });
      onTranslated(result);
      toast.success(t("adminPostPanes.translate.done"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground -mt-1">
        {t("adminPostPanes.translate.hint")}
      </p>
      {hasEnContent && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          {t("adminPostPanes.translate.overwriteWarning")}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={busy || !source.title_pl.trim()}
        onClick={() => void run()}
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />
        ) : (
          <Languages className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
        )}
        {busy ? t("adminPostPanes.translate.working") : t("adminPostPanes.translate.run")}
      </Button>
    </div>
  );
}
