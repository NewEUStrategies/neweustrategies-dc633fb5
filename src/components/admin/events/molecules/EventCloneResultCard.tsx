// Molekuła: PODSUMOWANIE KLONU na pulpicie nowej edycji.
//
// RAPORT Z JEDNEJ OPERACJI, NIE STAN WYDARZENIA. Wynik `admin_event_clone`
// (co skopiowano, co pominięto, czego z zasady nie przeniesiono, na co uważać)
// czeka w cache pod kluczem nowej edycji - wpisuje go mutacja klonu. Karta
// znika po zamknięciu i po odświeżeniu strony: to, co skopiowano, widać odtąd
// w sekcjach studia, a drugie źródło tej samej prawdy zestarzałoby się przy
// pierwszej edycji sesji.
import { useTranslation } from "react-i18next";
import { CheckCircle2, X } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { EventCloneItemList } from "@/components/admin/events/molecules/EventCloneItemList";
import { EventCloneNotices } from "@/components/admin/events/molecules/EventCloneNotices";
import { cloneItemEntries } from "@/lib/events/eventCloneLabels";
import { useDismissCloneResult, useEventCloneResult } from "@/lib/events/useEventClone";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

export function EventCloneResultCard({ eventId }: { eventId: string }) {
  ensureCloneI18n();
  const { t } = useTranslation();
  const result = useEventCloneResult(eventId);
  const dismiss = useDismissCloneResult(eventId);
  if (result === null) return null;

  return (
    <section
      className="space-y-3 rounded-lg border border-emerald-300/60 bg-emerald-50/60 p-4 dark:bg-emerald-950/20"
      aria-labelledby="event-clone-result-title"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h2
            id="event-clone-result-title"
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            {t("adminEventClone.result.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("adminEventClone.result.description")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("adminEventClone.result.dismiss")}
          onClick={dismiss}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <EventCloneNotices
        title={t("adminEventClone.result.warningsTitle")}
        notices={result.warnings}
        tone="warning"
      />
      <EventCloneItemList
        title={t("adminEventClone.result.copiedTitle")}
        entries={cloneItemEntries(result.copied)}
        emptyLabel={t("adminEventClone.result.nothing")}
      />
      <EventCloneItemList
        title={t("adminEventClone.result.skippedTitle")}
        entries={cloneItemEntries(result.skipped)}
        emptyLabel={t("adminEventClone.result.nothing")}
      />
    </section>
  );
}
