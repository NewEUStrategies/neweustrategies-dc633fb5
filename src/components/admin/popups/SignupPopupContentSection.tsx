// Sekcja "Popup rejestracji" w Admin → Popupy: pełny edytor treści, układu,
// pól i kolorów popupu rejestracji konta (newsletter_settings) z własnym
// zapisem i podglądem 1:1. Popup zakłada realne konto - newsletter jest w nim
// wyłącznie opcjonalnym checkboxem.
//
// ZAPIS GRUPĄ `popup` (S1 def. 9, D-S1-03). Sekcja wysyłała kiedyś CAŁE
// ustawienia newslettera, więc zapis treści popupu cofał zmianę nadawcy albo
// trybu zrobioną chwilę wcześniej w przeglądzie newslettera. Teraz edytor
// trzyma `base` (wiersz z chwili rozpoczęcia edycji, z tokenem `updated_at`)
// i szkic; do serwera idą WYŁĄCZNIE kolumny grupy `popup`, które operator
// zmienił. Cudzą zmianę innych kolumn scala mutator; prawdziwy konflikt (te
// same pola) kończy się komunikatem z akcją „Wczytaj aktualne", a szkic zostaje.
// Ten sam wzorzec ma `OverviewPanel` (grupa `overview`).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignupPopupEditor } from "@/components/admin/popups/signup/SignupPopupEditor";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import {
  useNewsletterSettings,
  newsletterSettingsQueryOptions,
  defaultNewsletterSettings,
  type NewsletterSettings,
} from "@/hooks/useNewsletterSettings";
import { SYNC_MESSAGE_KEYS, isStaleWriteError } from "@/lib/billing/planQueries";
import { ensureI18n as ensurePaywallSyncI18n } from "@/lib/i18n-admin-paywall-sync";
import {
  diffNewsletterSettings,
  usePatchNewsletterSettings,
} from "@/lib/newsletter/settingsQueries";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";
import { toastError } from "@/lib/toastError";
import "@/lib/i18n-admin-popup-signup";

/** Grupa kolumn tego edytora - biała lista po stronie TS i SQL (PLAN S1 §4.2). */
const SETTINGS_GROUP = "popup" as const;

export function SignupPopupContentSection() {
  ensurePaywallSyncI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useNewsletterSettings();
  const save = usePatchNewsletterSettings(SETTINGS_GROUP);
  const [base, setBase] = useState<NewsletterSettings | null>(null);
  const [draft, setDraft] = useState<NewsletterSettings | null>(null);

  // „Niezapisane" = realna różnica w kolumnach grupy względem bazy szkicu.
  // Reset do stanu, który już jest w bazie, nie jest zmianą - zapis nie
  // miałby czego wysłać.
  const dirty = useMemo(
    () =>
      base !== null &&
      draft !== null &&
      Object.keys(diffNewsletterSettings(base, draft, SETTINGS_GROUP)).length > 0,
    [base, draft],
  );

  // Bez niezapisanych zmian szkic idzie za serwerem (świeży token, cudze
  // zmiany widoczne od razu); ze zmianami - zostaje, inaczej odświeżenie
  // zapytania (inne okno, powrót do karty) wycierałoby wpisaną treść.
  useEffect(() => {
    if (data && !dirty) {
      setBase(data);
      setDraft(data);
    }
  }, [data, dirty]);

  const current = useMemo(() => draft ?? data ?? defaultNewsletterSettings(), [draft, data]);

  const update = (patch: Partial<NewsletterSettings>) => {
    setDraft((prev) => ({ ...(prev ?? data ?? defaultNewsletterSettings()), ...patch }));
  };

  // Akcja toastu konfliktu odpala się później - czyta stan z chwili kliknięcia.
  const latest = useRef({ base, draft });
  latest.current = { base, draft };

  /**
   * „Wczytaj aktualne": nowa baza = stan serwera, zmiany operatora (tylko
   * kolumny grupy) nałożone na nią - widzi cudzą zmianę obok swojej i zapisuje
   * świadomie, już z aktualnym tokenem.
   */
  const reloadCurrent = async () => {
    try {
      const fresh = await qc.fetchQuery({ ...newsletterSettingsQueryOptions(), staleTime: 0 });
      const { base: from, draft: mine } = latest.current;
      const changes = from && mine ? diffNewsletterSettings(from, mine, SETTINGS_GROUP) : {};
      setBase(fresh);
      setDraft({ ...fresh, ...changes });
      toast.info(t("adminPaywall.sync.reloaded"));
    } catch (err) {
      toastError(err, "load");
    }
  };

  const onSave = async () => {
    if (!base || !draft) return;
    const saved = draft;
    try {
      const result = await save.mutateAsync({
        base,
        draft: saved,
        expectedUpdatedAt: base.updated_at ?? null,
      });
      // Nowa baza = zapisany stan z nowym tokenem: kolejny zapis z tej karty
      // nie zderzy się z własną zmianą.
      setBase({ ...saved, updated_at: result.updatedAt ?? saved.updated_at });
      toast.success(result.merged ? t(SYNC_MESSAGE_KEYS.merged) : t("adminPopupSignup.saved"));
    } catch (err) {
      // Konflikt ma własny komunikat z akcją; każdy inny błąd - dotychczasowy
      // komunikat sekcji (szkic i znacznik zmian zostają w obu przypadkach).
      if (isStaleWriteError(err)) showSaveError(err, t, () => void reloadCurrent());
      else toast.error(t("adminPopupSignup.saveError"));
    }
  };

  return (
    <div className="space-y-4">
      <SignupPopupEditor value={current} onChange={update} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && (
          <span className="mr-auto text-xs text-muted-foreground">
            {t("adminPopupSignup.unsaved")}
          </span>
        )}
        <Button
          variant="outline"
          onClick={() => {
            update({ popup_design: defaultPopupDesign() });
            toast.success(t("adminPopupSignup.resetDone"));
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {t("adminPopupSignup.reset")}
        </Button>
        <Button onClick={() => void onSave()} disabled={!dirty || save.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {t("adminPopupSignup.save")}
        </Button>
      </div>
    </div>
  );
}
