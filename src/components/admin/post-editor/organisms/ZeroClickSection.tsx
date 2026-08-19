// Organizm: zakładka „Zero-click" edytora wpisu. Łączy ŚCIĄGAWKĘ (jak
// zaprojektować wpis) ze STANEM tego wpisu, osobno dla PL i EN - bo wersja
// angielska potrafi być tłumaczeniem, które zgubiło nagłówki-pytania.
//
// Zakładka istnieje TYLKO w edytorze wpisu (PostDetailsNav / PostDetailsPanel
// montowane wyłącznie z trasy admin.posts.$slug). Edytor stron, builder i
// pozostałe panele jej nie widzą - taki był wymóg: ściągawka ma się pokazywać
// przy tworzeniu i edytowaniu wpisów, nigdzie indziej.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { analyzeZeroClick } from "@/lib/seo/zeroClick";
import { SectionCard } from "../atoms";
import { ZeroClickChecklist, ZeroClickCheatSheet } from "../molecules";
import type { PostEditorFormApi } from "../hooks";
import { ensureI18n } from "@/lib/i18n-admin-zero-click";

export function ZeroClickSection({ formApi }: { formApi: PostEditorFormApi }) {
  ensureI18n();
  const { t } = useTranslation();
  const { form } = formApi;

  const contentPl = form?.content_pl ?? null;
  const contentEn = form?.content_en ?? null;
  const blocks = form?.blocks_data ?? null;
  const takeawaysPl = form?.takeaways_pl;
  const takeawaysEn = form?.takeaways_en;

  // Pomiar jedzie przy każdej zmianie treści, więc trzyma go `useMemo` -
  // analiza chodzi po całym drzewie bloków, a redaktor pisze znak po znaku.
  const reportPl = useMemo(
    () =>
      analyzeZeroClick({
        html: contentPl,
        blocks: blocks?.pl ?? null,
        takeaways: takeawaysPl,
      }),
    [contentPl, blocks, takeawaysPl],
  );
  const reportEn = useMemo(
    () =>
      analyzeZeroClick({
        html: contentEn,
        blocks: blocks?.en ?? null,
        takeaways: takeawaysEn,
      }),
    [contentEn, blocks, takeawaysEn],
  );

  if (!form) return null;

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("adminZeroClick.title")}
        icon={Sparkles}
        description={t("adminZeroClick.intro")}
        bodyClassName="p-4 space-y-4"
      >
        <div>
          <h3 className="text-sm font-semibold mb-3">{t("adminZeroClick.checklist.title")}</h3>
          <div className="grid gap-5 md:grid-cols-2">
            <ZeroClickChecklist report={reportPl} label={t("adminZeroClick.checklist.langPl")} />
            <ZeroClickChecklist report={reportEn} label={t("adminZeroClick.checklist.langEn")} />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t("adminZeroClick.checklist.hint")}
          </p>
        </div>
        <div className="border-t border-border pt-1">
          <ZeroClickCheatSheet />
        </div>
      </SectionCard>
    </div>
  );
}
