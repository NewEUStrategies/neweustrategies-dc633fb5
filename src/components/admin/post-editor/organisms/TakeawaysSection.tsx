// Organizm: sekcja "Dowiesz się…" (zakładka szczegółów). Kluczowe punkty PL/EN
// + wybór wariantu wizualnego. Kadr karty zapewnia atom SectionCard.
import { useTranslation } from "react-i18next";
import { TakeawaysTab } from "@/components/admin/PostSettingsMetabox";
import { SectionCard, InfoHint } from "../atoms";
import type { PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";
// Punkty „Dowiesz się…" nie są ozdobą: idą do JSON-LD jako `abstract`, więc
// reguła zero-click (3-5 samodzielnych zdań) musi stać przy tym polu.
import "@/lib/i18n-admin-zero-click";

export function TakeawaysSection({ formApi }: { formApi: PostEditorFormApi }) {
  const { t } = useTranslation();
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          {t("adminPostPanes.sections.takeawaysTitle")}
          <InfoHint text={t("adminZeroClick.hints.takeaways")} />
        </span>
      }
      description={t("adminPostPanes.sections.takeawaysHint")}
    >
      <TakeawaysTab
        pl={form.takeaways_pl ?? []}
        en={form.takeaways_en ?? []}
        onChange={(lang, next) => set(lang === "pl" ? "takeaways_pl" : "takeaways_en", next)}
        variantOverride={form.takeaways_variant ?? null}
        onVariantChange={(next) => set("takeaways_variant", next)}
      />
    </SectionCard>
  );
}
