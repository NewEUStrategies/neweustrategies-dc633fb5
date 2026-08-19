import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { PanelSaveBar } from "@/components/admin/postExperience/molecules/PanelSaveBar";
import { PostLayoutGroup } from "@/components/admin/postExperience/molecules/PostLayoutGroup";
import { PostLayoutRatioSection } from "@/components/admin/postExperience/molecules/PostLayoutRatioSection";
import { PostLayoutTogglesSection } from "@/components/admin/postExperience/molecules/PostLayoutTogglesSection";
import { PostLayoutTypographySection } from "@/components/admin/postExperience/molecules/PostLayoutTypographySection";
import { usePostLayoutSettings, useSavePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { adminToast } from "@/lib/adminToasts";
import { draftDirty } from "@/lib/admin/panelDraft";
import { layoutGroups } from "@/lib/post/layoutPanelRules";
import type { PostLayoutSettings } from "@/lib/postLayouts";
import { ensureI18n as ensureAdminLayoutsI18n } from "@/lib/i18n-admin-layouts";

/**
 * Organizm: panel globalnych układów wpisu.
 *
 * Wiąże `usePostLayoutSettings` z molekułami. Reguły (grupy układów, wybór
 * presetu, łata wariantu z sidebarem, wiersze typografii, podsumowanie presetu)
 * siedzą w `lib/post/layoutPanelRules` - poprzednia wersja liczyła je
 * w komponencie zadeklarowanym WEWNĄTRZ funkcji trasy, czyli w miejscu, którego
 * nie da się ani zaimportować, ani przetestować.
 */
export function PostLayoutsSettingsPanel() {
  ensureAdminLayoutsI18n();
  const { t } = useTranslation();
  const { data } = usePostLayoutSettings();
  const save = useSavePostLayoutSettings();
  /**
   * Szkic i STAN ODNIESIENIA brane w tej samej chwili.
   *
   * Poprzednia wersja trzymała tylko szkic i porównywała go z żywym `data`
   * z react-query. To znaczy, że odświeżenie w tle (unieważnienie, powrót do
   * okna, wygaśnięcie `staleTime`) potrafiło ZMIENIĆ znaczenie „są niezapisane
   * zmiany" w trakcie edycji: nowa odpowiedź serwera stawała się punktem
   * odniesienia, choć użytkownik jej nie widział. Odniesienie jest tu zamrożone
   * razem ze szkicem, więc odpowiada temu, co administrator miał na ekranie.
   */
  const [draft, setDraft] = useState<{
    local: PostLayoutSettings;
    baseline: PostLayoutSettings;
  } | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft({ local: data, baseline: data });
  }, [data, draft]);

  if (!draft) {
    return (
      <AdminShell hideSidebar>
        <div className="p-6">{t("adminLayouts.postLayouts.loading")}</div>
      </AdminShell>
    );
  }

  const local = draft.local;
  const patch = (p: Partial<PostLayoutSettings>) =>
    setDraft({ ...draft, local: { ...draft.local, ...p } });
  const dirty = draftDirty(draft.local, draft.baseline);

  const onSave = async () => {
    // MIGAWKA WYSYŁANA, nie „bieżący szkic". Po udanym zapisie odniesieniem
    // staje się DOKŁADNIE to, co poszło do bazy - nie stan z chwili odpowiedzi.
    // Różnica jest widoczna, gdy administrator edytuje dalej w czasie żądania:
    // te późniejsze zmiany muszą zostać niezapisane, a nie zniknąć razem
    // z odpowiedzią serwera.
    const snapshot = draft.local;
    const { tenant_id, ...rest } = snapshot;
    void tenant_id;
    try {
      await save.mutateAsync(rest);
      // Bez tego kroku `dirty` zostaje prawdziwe po udanym zapisie: przyciski
      // zapisu i przywrócenia zostają czynne, a „przywróć" cofa do stanu SPRZED
      // zapisu, czyli wyrzuca to, co właśnie utrwalono.
      setDraft((d) => (d ? { ...d, baseline: snapshot } : d));
      toast.success(adminToast.layoutSaved());
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("adminLayouts.postLayouts.saveFailed");
      toast.error(t("adminLayouts.postLayouts.saveErrorToast", { msg }));
    }
  };

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-xl">{t("adminLayouts.postLayouts.pageTitle")}</h1>
            <p className="text-xs text-muted-foreground">{t("adminLayouts.postLayouts.intro")}</p>
          </div>
          <PanelSaveBar
            canSave={dirty}
            // TU reset znaczy „porzuć moje zmiany", nie „wróć do domyślnych":
            // ten panel nie ma zestawu wartości domyślnych do przywrócenia -
            // układy przychodzą z katalogu presetów, nie ze schematu ustawień.
            // Dlatego oba przyciski dzielą warunek, i to jest świadome.
            canReset={dirty}
            pending={save.isPending}
            saveLabel={t("common.save")}
            savingLabel={t("adminLayouts.postLayouts.saving")}
            resetLabel={t("common.reset")}
            onSave={() => void onSave()}
            onReset={() => setDraft({ ...draft, local: draft.baseline })}
          />
        </header>

        {layoutGroups().map((group) => (
          <PostLayoutGroup key={group.field} group={group} settings={local} onPatch={patch} />
        ))}

        <PostLayoutRatioSection settings={local} onPatch={patch} />
        <PostLayoutTypographySection settings={local} onPatch={patch} />
        <PostLayoutTogglesSection settings={local} onPatch={patch} />
      </div>
    </AdminShell>
  );
}
