// Organizm: karta tłumaczenia PL->EN. Wynik ląduje w formularzu JEDNĄ zmianą
// (undo cofa całość), a dokument bloków EN tylko dla edytora blokowego.
// Tłumaczenie trwa kilka sekund - wynik trafia WYŁĄCZNIE do wpisu, z którego
// wzięto źródło; po przejściu redaktora na inny wpis jest porzucany.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { SidebarSection } from "../atoms";
import { TranslateCard } from "../molecules";
import type { PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

export function PostTranslateCard({ formApi }: { formApi: PostEditorFormApi }) {
  const { t } = useTranslation();
  const { form, history } = formApi;
  // Wpis aktualnie w formularzu - czytany w chwili, gdy tłumaczenie WRACA
  // (domknięcie `onTranslated` pamięta wpis z chwili kliknięcia).
  const liveFormIdRef = useRef<string | null>(null);
  liveFormIdRef.current = form?.id ?? null;
  if (!form) return null;
  const sourcePostId = form.id;
  return (
    <SidebarSection
      title={t("adminPostPanes.translate.title")}
      icon={Languages}
      defaultOpen={false}
    >
      <TranslateCard
        source={{
          title_pl: form.title_pl,
          excerpt_pl: form.excerpt_pl,
          takeaways_pl: form.takeaways_pl,
          seo_title_pl: form.seo_title_pl,
          seo_description_pl: form.seo_description_pl,
          content_pl:
            form.editor === "richtext" || form.editor === "markdown" ? form.content_pl : null,
          blocks_pl: form.editor === "blocks" ? (form.blocks_data?.pl?.blocks ?? null) : null,
        }}
        hasEnContent={!!form.title_en.trim() || (form.blocks_data?.en?.blocks?.length ?? 0) > 0}
        onTranslated={(result) => {
          // Redaktor przeszedł w międzyczasie na inny wpis: tłumaczenie wpisu A
          // nie może nadpisać wersji EN wpisu B.
          if (liveFormIdRef.current !== sourcePostId) return;
          // Szkic tłumaczenia wchodzi do formularza jedną zmianą (undo cofa
          // całość). Dokument bloków EN tylko dla edytora blokowego.
          history.set((prev) => {
            // Bezpiecznik na stanie bieżącym: karta mogła zostać przemontowana.
            if (!prev || prev.id !== sourcePostId) return prev;
            return {
              ...prev,
              title_en: result.title_en || prev.title_en,
              excerpt_en: result.excerpt_en ?? prev.excerpt_en,
              takeaways_en:
                result.takeaways_en.length > 0 ? result.takeaways_en : prev.takeaways_en,
              seo_title_en: result.seo_title_en ?? prev.seo_title_en,
              seo_description_en: result.seo_description_en ?? prev.seo_description_en,
              content_en: result.content_en ?? prev.content_en,
              blocks_data:
                prev.editor === "blocks" && result.blocks_en
                  ? {
                      pl: prev.blocks_data?.pl ?? { version: 1, blocks: [] },
                      en: { version: 1, blocks: result.blocks_en },
                    }
                  : prev.blocks_data,
            };
          });
        }}
      />
    </SidebarSection>
  );
}
