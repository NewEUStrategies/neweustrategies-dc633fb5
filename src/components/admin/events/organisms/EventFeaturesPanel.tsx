// Organizm: „Funkcje dodatkowe" wydarzenia - siedem przelacznikow modulow.
//
// TEN EKRAN COS ROBI. Do tej zmiany byl drogowskazem („per wydarzenie przyjdzie
// tu wybor…"), a kolumna `events.features` nie bramkowala niczego. Przelacznik,
// ktory nie wylacza sekcji, klamie - dlatego zapis idzie do RPC, a rama studia
// czyta z tej samej kolumny zbior pozycji, ktorych sidebar NIE renderuje.
//
// OPIS MUSI POWIEDZIEC DWIE RZECZY, bo bez nich przelacznik jest mylacy:
// (1) wylaczenie CHOWA SEKCJE W PANELU i nie usuwa danych - zgloszenia, sesje
// i stoliki zostaja, wracaja po ponownym wlaczeniu; (2) to NIE JEST widocznosc
// publiczna - tym, co widzi uczestnik, rzadzi osobne zrodlo prawdy
// (`event_page_sections` + `event_sections`), a dwa przelaczniki na te sama
// rzecz znaczylyby dwa miejsca, w ktorych mozna ja wylaczyc, i jedno, ktore
// ktos pamieta.
//
// KAZDY PRZELACZNIK MA ZDANIE „CO ZNIKNIE". Sama etykieta („Spotkania") nie
// mowi, czy wylaczenie zabiera stoliki, wnioski o rozmowe, czy jedno i drugie -
// a to jest dokladnie ta informacja, ktorej redaktor szuka przed klikiem.
//
// ZAPIS JEST JAWNY, jak na kazdym ekranie studia: pasek zapisu pojawia sie przy
// zmianie. Przelacznik zapisywany od razu chowalby polowe sidebara w reakcji na
// przypadkowy klik, bez kroku „odrzuc zmiany".
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import {
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import {
  EVENT_FEATURE_HINT_KEYS,
  EVENT_FEATURE_KEYS,
  EVENT_FEATURE_LABEL_KEYS,
  eventFeaturesDirty,
  eventFeaturesFromJson,
  eventFeaturesPayload,
  type EventFeaturesDraft,
} from "@/lib/events/eventFeatures";
import { useSaveEventFeatures } from "@/lib/events/useAdminEventDetail";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export function EventFeaturesPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();

  const saved = useMemo(() => eventFeaturesFromJson(row.features), [row.features]);
  const [draft, setDraft] = useState<EventFeaturesDraft>(saved);
  // Po zapisie (i po przelaczeniu wydarzenia) szkic wraca do stanu z bazy -
  // inaczej pasek zapisu zostawalby otwarty nad danymi, ktore sa juz zapisane.
  useEffect(() => setDraft(saved), [saved]);

  const save = useSaveEventFeatures(row.id);
  const dirty = eventFeaturesDirty(draft, saved);

  const submit = () => {
    save.mutate(eventFeaturesPayload(draft), {
      onSuccess: () => toast.success(t("adminEvents.studio.toasts.featuresSaved")),
      onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
    });
  };

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.features")}>
      <EventStudioRow
        label={t("adminEvents.studio.features.modulesLabel")}
        description={t("adminEvents.studio.features.modulesDescription")}
        hint={
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("adminEvents.studio.features.notPublicVisibility")}
          </p>
        }
      >
        {EVENT_FEATURE_KEYS.map((key) => (
          <AdminFormSwitchRow
            key={key}
            id={`event-feature-${key}`}
            label={t(EVENT_FEATURE_LABEL_KEYS[key])}
            hint={t(EVENT_FEATURE_HINT_KEYS[key])}
            checked={draft[key]}
            onCheckedChange={(next) => setDraft((previous) => ({ ...previous, [key]: next }))}
          />
        ))}
        {/* Adres ukrytej sekcji nadal dziala - to nie jest szczegol techniczny,
            tylko odpowiedz na pytanie „czy zepsuje linki, ktore juz wyslalem". */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("adminEvents.studio.features.routesStayAlive")}
        </p>
      </EventStudioRow>

      <EventStudioSaveBar
        dirty={dirty}
        saving={save.isPending}
        saveLabel={t("adminEvents.studio.actions.save")}
        discardLabel={t("adminEvents.studio.actions.discard")}
        savingLabel={t("adminEvents.studio.actions.saving")}
        onSave={submit}
        onDiscard={() => setDraft(saved)}
      />
    </EventStudioPage>
  );
}
