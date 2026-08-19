import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PanelSaveBar } from "@/components/admin/postExperience/molecules/PanelSaveBar";
import { PreviewLangTabs } from "@/components/admin/postExperience/molecules/PreviewLangTabs";
import { TocColorsSection } from "@/components/admin/postExperience/molecules/TocColorsSection";
import { TocGeneralSection } from "@/components/admin/postExperience/molecules/TocGeneralSection";
import { TocLabelsSection } from "@/components/admin/postExperience/molecules/TocLabelsSection";
import { TocPreviewCard } from "@/components/admin/postExperience/molecules/TocPreviewCard";
import { draftDirty } from "@/lib/admin/panelDraft";
import { uiLang } from "@/lib/i18n/format";
import {
  TOC_DEFAULTS,
  useSaveTocDefaults,
  useTocDefaults,
  type TocDefaults,
} from "@/lib/toc/settings";

/**
 * Organizm: panel globalnych ustawień spisu treści.
 *
 * Wiąże warstwę danych (`useTocDefaults` / `useSaveTocDefaults`) z molekułami i
 * przekazuje intencje. NIE liczy tu żadnej reguły: „czy są niezapisane zmiany"
 * to `draftDirty`, przycięcie liczb to `clampNumber` w atomie pola, a wygląd
 * podglądu - moduł `lib/toc/panelRules`. Trasa `/admin/toc` składa się z
 * `createFileRoute` i tego organizmu.
 */
export function TocSettingsPanel() {
  const { i18n, t } = useTranslation();
  const persisted = useTocDefaults();
  const [draft, setDraft] = useState<TocDefaults>(persisted);
  const [previewLang, setPreviewLang] = useState<"pl" | "en">(uiLang(i18n.language));
  const save = useSaveTocDefaults();

  const dirty = draftDirty(draft, persisted);

  const update = <K extends keyof TocDefaults>(key: K, value: TocDefaults[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const updateColor = (key: keyof TocDefaults["colors"], value: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold">{t("admin.toc.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("admin.toc.subtitle")}</p>
        </div>
        <PanelSaveBar
          canSave={dirty}
          // ZACHOWANE ZACHOWANIE, NIE PRZEOCZENIE. Poprzednia wersja panelu
          // wyłączała „przywróć domyślne" tym samym warunkiem co zapis, więc
          // przy zapisanym wierszu różnym od domyślnych przycisk był martwy.
          // Wyprowadzenie panelu nie zmienia zachowania - poprawka pytania
          // („różnica wobec DOMYŚLNYCH", nie wobec bazy) idzie osobnym commitem,
          // bo to defekt, nie refaktor.
          canReset={dirty}
          pending={save.isPending}
          saveLabel={t("common.save")}
          savingLabel={t("admin.toc.saving")}
          resetLabel={t("common.reset")}
          onSave={() => save.mutate(draft)}
          onReset={() => setDraft(TOC_DEFAULTS)}
        />
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
        <div className="space-y-5 rounded-xl border border-border bg-card p-5">
          <TocGeneralSection draft={draft} onChange={update} />
          <TocLabelsSection draft={draft} onChange={update} />
          <TocColorsSection colors={draft.colors} onChangeColor={updateColor} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{t("admin.toc.preview")}</div>
            <PreviewLangTabs
              value={previewLang}
              onChange={setPreviewLang}
              label={t("admin.toc.previewLang")}
            />
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <TocPreviewCard settings={draft} lang={previewLang} />
          </div>
        </div>
      </div>
    </div>
  );
}
