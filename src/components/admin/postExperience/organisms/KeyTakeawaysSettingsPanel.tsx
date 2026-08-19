import { PanelSectionHeading, PanelTextField } from "@/components/admin/postExperience/atoms";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-post-panes";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingToggle } from "@/components/admin/atoms/SettingToggle";
import { PanelSaveBar } from "@/components/admin/postExperience/molecules/PanelSaveBar";
import { PreviewLangTabs } from "@/components/admin/postExperience/molecules/PreviewLangTabs";
import { KeyTakeawaysColorsSection } from "@/components/admin/postExperience/molecules/KeyTakeawaysColorsSection";
import { KeyTakeawaysHighlightSection } from "@/components/admin/postExperience/molecules/KeyTakeawaysHighlightSection";
import { KeyTakeawaysIconPicker } from "@/components/admin/postExperience/molecules/KeyTakeawaysIconPicker";
import { KeyTakeawaysPreviewCard } from "@/components/admin/postExperience/molecules/KeyTakeawaysPreviewCard";
import { KeyTakeawaysVariantPicker } from "@/components/admin/postExperience/molecules/KeyTakeawaysVariantPicker";
import { draftDirty } from "@/lib/admin/panelDraft";
import { uiLang } from "@/lib/i18n/format";
import {
  KEY_TAKEAWAYS_DEFAULTS,
  useKeyTakeawaysSettings,
  useSaveKeyTakeawaysSettings,
  type KeyTakeawaysSettings,
  type KeyTakeawaysVariant,
} from "@/lib/keyTakeaways/settings";

/**
 * Organizm: panel globalnych ustawień sekcji „Z tego artykułu dowiesz się…".
 *
 * Wiąże warstwę danych z molekułami i przekazuje intencje. Reguły siedzą
 * w `lib/keyTakeaways/panelRules` i `lib/admin/panelDraft` - tutaj nie ma ani
 * jednego warunku decydującego o treści.
 */
export function KeyTakeawaysSettingsPanel() {
  const { i18n, t } = useTranslation();
  const persisted = useKeyTakeawaysSettings();
  const [draft, setDraft] = useState<KeyTakeawaysSettings>(persisted);
  const [previewLang, setPreviewLang] = useState<"pl" | "en">(uiLang(i18n.language));
  const [previewVariant, setPreviewVariant] = useState<KeyTakeawaysVariant>(persisted.variant);
  const save = useSaveKeyTakeawaysSettings();

  const dirty = draftDirty(draft, persisted);
  const resettable = draftDirty(draft, KEY_TAKEAWAYS_DEFAULTS);

  const update = <K extends keyof KeyTakeawaysSettings>(key: K, value: KeyTakeawaysSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const updateColor = (key: keyof KeyTakeawaysSettings["colors"], value: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));

  /** Wybór wariantu przestawia JEDNOCZEŚNIE ustawienie i zakładkę podglądu. */
  const pickVariant = (variant: KeyTakeawaysVariant) => {
    update("variant", variant);
    setPreviewVariant(variant);
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {t("adminPostPanes.keyTakeaways.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {t("adminPostPanes.keyTakeaways.pageIntro")}
          </p>
        </div>
        <PanelSaveBar
          canSave={dirty}
          // Jak w panelu spisu treści: reset pyta o różnicę wobec DOMYŚLNYCH,
          // a zapis o różnicę wobec bazy.
          canReset={resettable}
          pending={save.isPending}
          saveLabel={t("adminPostPanes.keyTakeaways.save")}
          savingLabel={t("adminPostPanes.keyTakeaways.saving")}
          resetLabel={t("adminPostPanes.keyTakeaways.reset")}
          onSave={() => save.mutate(draft)}
          onReset={() => setDraft(KEY_TAKEAWAYS_DEFAULTS)}
        />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6">
        <div className="space-y-6 rounded-xl border bg-card p-5 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <SettingToggle
            label={t("adminPostPanes.keyTakeaways.enabled")}
            hint={t("adminPostPanes.keyTakeaways.enabledHint")}
            checked={draft.enabled}
            onCheckedChange={(v) => update("enabled", v)}
          />

          <KeyTakeawaysVariantPicker value={draft.variant} onChange={pickVariant} />

          <section className="space-y-3">
            <PanelSectionHeading as="h3" tone="field">
              {t("adminPostPanes.keyTakeaways.labelHeading")}
            </PanelSectionHeading>
            <PanelTextField
              label={t("adminPostPanes.keyTakeaways.labelPl")}
              value={draft.labelPl}
              onChange={(v) => update("labelPl", v)}
              inputClassName=""
            />
            <PanelTextField
              label={t("adminPostPanes.keyTakeaways.labelEn")}
              value={draft.labelEn}
              onChange={(v) => update("labelEn", v)}
              inputClassName=""
            />
          </section>

          <KeyTakeawaysHighlightSection
            labelPl={draft.labelPl}
            labelEn={draft.labelEn}
            highlight={draft.highlight}
            accent={draft.colors.accent}
            onChange={(next) => update("highlight", next)}
          />

          <KeyTakeawaysIconPicker value={draft.icon} onChange={(v) => update("icon", v)} />

          <KeyTakeawaysColorsSection
            colors={draft.colors}
            onChangeColor={updateColor}
            onChangeBorderWidth={(width) =>
              setDraft((d) => ({ ...d, colors: { ...d.colors, borderWidth: width } }))
            }
          />
        </div>

        <div className="rounded-xl border bg-background p-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="text-sm font-semibold">
              {t("adminPostPanes.keyTakeaways.previewHeading")}
            </div>
            <div className="flex items-center gap-2">
              <PreviewLangTabs
                value={previewLang}
                onChange={setPreviewLang}
                label={t("adminPostPanes.keyTakeaways.previewLang")}
              />
              <Tabs
                value={previewVariant}
                onValueChange={(next) => setPreviewVariant(next as KeyTakeawaysVariant)}
              >
                <TabsList aria-label={t("adminPostPanes.keyTakeaways.previewVariant")}>
                  <TabsTrigger value="card">A</TabsTrigger>
                  <TabsTrigger value="heading">B</TabsTrigger>
                  <TabsTrigger value="ghost">C</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <KeyTakeawaysPreviewCard settings={draft} variant={previewVariant} lang={previewLang} />

          <p className="mt-6 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            {t("adminPostPanes.keyTakeaways.previewNote")}
          </p>
        </div>
      </div>
    </div>
  );
}
