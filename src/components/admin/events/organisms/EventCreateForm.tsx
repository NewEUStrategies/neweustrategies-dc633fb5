// Organizm: NOWE WYDARZENIE z rodzaju - cztery pola, nie osiemnaście.
//
// TO JEST CAŁA IDEA TEGO EKRANU. Redaktor podaje tytuł w dwóch językach, termin
// i rodzaj. Pozostałe jedenaście ustawień (format, tryb i przepływ rejestracji,
// tryb gościa, limit miejsc, czas trwania, próg członkostwa, Chatham House)
// przepisuje RODZAJ - po stronie serwera, w `admin_event_create`. Formularz,
// który pytałby o wszystko, zmusza redaktora do decyzji, których jeszcze nie
// umie podjąć, a każda inna ścieżka tworzenia (import, klon edycji, webhook)
// musiałaby powtórzyć tę samą logikę.
//
// PODGLĄD DZIEDZICZENIA JEST CZĘŚCIĄ FORMULARZA. Po wybraniu rodzaju redaktor
// widzi, CO dokładnie z niego przyjdzie. Bez tego „ustawienia przepisze rodzaj"
// jest obietnicą bez pokrycia - a pierwsze zaskoczenie (wydarzenie tylko dla
// członków, choć nikt tego nie zaznaczył) kończy zaufanie do domyślnych wartości.
//
// BRAK AKTYWNEGO RODZAJU BLOKUJE FORMULARZ Z INSTRUKCJĄ, a nie pustą droplistą.
// Pusta droplista wygląda na awarię; zdanie „dodaj rodzaj w katalogu" mówi, co
// zrobić - i to jest wzorzec pustego stanu obowiązujący w całym module.
//
// TERMIN JEST WYMAGANY, bo bez niego wydarzenia nie da się ustawić w kalendarzu
// ani policzyć kolizji sesji; CHECK bazy tego nie pilnuje (`starts_at` ma
// wartość domyślną), więc pilnuje formularz i RPC.
//
// TO JEST STRONA, NIE OKNO MODALNE. Tworzenie wydarzenia ma własny adres
// (`/admin/events/new`), więc redaktor może je odświeżyć, wrócić „wstecz"
// i przesłać link, a podgląd dziedziczenia rodzaju nie jest ściśnięty do
// wysokości popupu.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AdminFormDateTimeRow } from "@/components/admin/molecules/AdminFormDateTimeRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { uiLang } from "@/lib/i18n/format";
import {
  EVENT_FORMATS,
  EVENT_FORMAT_LABEL_KEYS,
  EVENT_GUEST_MODE_LABEL_KEYS,
  EVENT_REGISTRATION_FLOW_LABEL_KEYS,
  EVENT_REGISTRATION_MODE_LABEL_KEYS,
  asEventFormat,
  asEventGuestMode,
  asEventRegistrationFlow,
  asEventRegistrationMode,
  type EventFormat,
  type EventTypeOption,
} from "@/lib/events/eventTypes";
import { DEFAULT_EVENT_TIME_ZONE, timeZoneOptions } from "@/lib/events/timeZoneOptions";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export interface EventCreateDraft {
  eventTypeId: string;
  titlePl: string;
  titleEn: string;
  startsAt: string;
  /**
   * Koniec podany WPROST. Pusty napis znaczy „wylicz z czasu trwania rodzaju" -
   * dokładnie to robi `admin_event_create`, więc formularz nie musi zgadywać
   * długości wydarzenia za redaktora.
   */
  endsAt: string;
  /** Nazwa IANA. Zapisywana zawsze - `events.timezone` jest NOT NULL. */
  timezone: string;
  /** Format wybrany na ekranie; pusty napis znaczy „format rodzaju". */
  format: string;
  city: string;
  country: string;
  externalRegistrationUrl: string;
}

export const EMPTY_EVENT_CREATE_DRAFT: EventCreateDraft = {
  eventTypeId: "",
  titlePl: "",
  titleEn: "",
  startsAt: "",
  endsAt: "",
  timezone: DEFAULT_EVENT_TIME_ZONE,
  format: "",
  city: "",
  country: "",
  externalRegistrationUrl: "",
};

/** Adres dopuszczalny jako cel zapisów zewnętrznych. Ta sama reguła stoi w bazie. */
const EXTERNAL_URL_PATTERN = /^https:\/\/\S+$/;

/**
 * Klucz i18n powodu odrzucenia albo `null`, gdy wersja robocza jest gotowa.
 *
 * `registrationMode` jest PARAMETREM, a nie wyliczeniem z `draft`: tryb niesie
 * wybrany rodzaj, a nie formularz. Dzięki temu reguła zostaje czysta i daje się
 * przetestować bez listy rodzajów, a jednocześnie widzi to, co zobaczy baza -
 * dla trybu `external` warunek `events_external_mode_requires_url` odrzuci
 * wydarzenie bez adresu, więc formularz musi zapytać o niego ZAWCZASU.
 */
export function eventCreateIssue(
  draft: EventCreateDraft,
  registrationMode: string | null,
): string | null {
  if (draft.titlePl.trim() === "" || draft.titleEn.trim() === "") {
    return "adminEvents.list.create.errors.titles";
  }
  if (draft.startsAt.trim() === "") return "adminEvents.list.create.errors.startsAt";
  if (draft.eventTypeId === "") return "adminEvents.list.create.errors.type";
  // Ta sama reguła stoi w `admin_event_create` (`invalid_ends_at`): koniec przed
  // początkiem daje wydarzenie, którego nie da się ustawić w kalendarzu.
  if (draft.endsAt.trim() !== "") {
    const starts = new Date(draft.startsAt).getTime();
    const ends = new Date(draft.endsAt).getTime();
    if (!Number.isFinite(ends) || !Number.isFinite(starts) || ends <= starts) {
      return "adminEvents.list.create.errors.endsAt";
    }
  }
  if (draft.timezone.trim() === "") return "adminEvents.list.create.errors.timezone";
  if (draft.format !== "" && !(EVENT_FORMATS as readonly string[]).includes(draft.format)) {
    return "adminEvents.list.create.errors.format";
  }
  if (registrationMode === "external") {
    const url = draft.externalRegistrationUrl.trim();
    if (url === "") return "adminEvents.list.create.errors.externalUrl";
    if (!EXTERNAL_URL_PATTERN.test(url) || url.length > 2048) {
      return "adminEvents.list.create.errors.externalUrlInvalid";
    }
  }
  return null;
}

export function EventCreateForm({
  types,
  isSaving,
  onCancel,
  onSubmit,
  onDraftChange,
}: {
  /** Wyłącznie rodzaje AKTYWNE - filtrowanie należy do wywołującego. */
  types: readonly EventTypeOption[];
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (draft: EventCreateDraft) => void;
  /**
   * Szkic w gore, na zywo. Rama studia rysuje w sidebarze tytul i termin
   * WPISYWANE w tym formularzu, zeby przejscie z kreatora do studia nie
   * przesunelo naglowka nawigacji - po zapisie stoi tam ta sama nazwa i ta
   * sama data, ktore redaktor widzial sekunde wczesniej.
   */
  onDraftChange?: (draft: EventCreateDraft) => void;
}) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<EventCreateDraft>(EMPTY_EVENT_CREATE_DRAFT);

  // Raport w gore idzie EFEKTEM, nie wewnatrz `setDraft`: wywolanie funkcji
  // rodzica w trakcie obslugi zdarzenia znaczy `setState` rodzica podczas
  // renderu dziecka, a to Reactowi nie wolno.
  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const selected = useMemo(
    () => types.find((type) => type.id === draft.eventTypeId) ?? null,
    [types, draft.eventTypeId],
  );

  const zones = timeZoneOptions(draft.timezone);
  const registrationMode = selected === null ? null : selected.default_registration_mode;
  const issue = eventCreateIssue(draft, registrationMode);
  const noTypes = types.length === 0;

  const cancel = () => {
    setDraft(EMPTY_EVENT_CREATE_DRAFT);
    onCancel();
  };

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader className="space-y-1">
        <h1 className="text-lg font-semibold">{t("adminEvents.list.create.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminEvents.list.create.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {noTypes ? (
          <p className="text-sm text-destructive" role="alert">
            {t("adminEvents.list.create.errors.noTypes")}
          </p>
        ) : (
          <div className="space-y-3">
            <AdminFormEnumRow<string>
              id="event-create-type"
              label={t("adminEvents.list.create.typeLabel")}
              hint={t("adminEvents.list.create.typeHint")}
              value={draft.eventTypeId}
              placeholder={t("adminEvents.list.create.typePlaceholder")}
              options={types.map((type) => type.id)}
              labelFor={(id) => {
                const type = types.find((candidate) => candidate.id === id);
                if (type === undefined) return id;
                const primary = lang === "en" ? type.name_en : type.name_pl;
                return primary === "" ? type.key : primary;
              }}
              // Wybór rodzaju PRZEPISUJE format do szkicu, zamiast pozostawiać
              // pole puste: format jest dalej edytowalny, ale redaktor widzi
              // wprost wartość, którą dostanie wydarzenie, a nie pusty przycisk.
              onValueChange={(value) => {
                const type = types.find((candidate) => candidate.id === value) ?? null;
                setDraft({
                  ...draft,
                  eventTypeId: value,
                  format: type === null ? draft.format : type.default_format,
                });
              }}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <AdminFormTextRow
                id="event-create-title-pl"
                label={t("adminEvents.list.create.titlePlLabel")}
                value={draft.titlePl}
                maxLength={200}
                autoFocus
                onValueChange={(value) => setDraft({ ...draft, titlePl: value })}
              />
              <AdminFormTextRow
                id="event-create-title-en"
                label={t("adminEvents.list.create.titleEnLabel")}
                value={draft.titleEn}
                maxLength={200}
                onValueChange={(value) => setDraft({ ...draft, titleEn: value })}
              />
            </div>

            {/* Kalendarz jest NASZ, nie systemowy - `datetime-local` rysowałby
                popup przeglądarki obok droplisty z naszymi tokenami. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <AdminFormDateTimeRow
                id="event-create-starts-at"
                label={t("adminEvents.list.create.startsAtLabel")}
                value={draft.startsAt}
                onValueChange={(value) => setDraft({ ...draft, startsAt: value })}
              />
              {/* Koniec jest OPCJONALNY, nie wymagany: rodzaj zna czas trwania
                  i baza go doliczy. Pole stoi tu dla wydarzeń, które trwają
                  inaczej niż wzorzec rodzaju (dzień konferencji, nie webinar). */}
              <AdminFormDateTimeRow
                id="event-create-ends-at"
                label={t("adminEvents.list.create.endsAtLabel")}
                hint={t("adminEvents.list.create.startsAtHint")}
                value={draft.endsAt}
                minDate={draft.startsAt === "" ? undefined : new Date(draft.startsAt)}
                onValueChange={(value) => setDraft({ ...draft, endsAt: value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <AdminFormEnumRow<string>
                id="event-create-timezone"
                label={t("adminEvents.list.create.timeZoneLabel")}
                hint={t("adminEvents.list.create.timeZoneHint")}
                value={draft.timezone}
                options={zones}
                labelFor={(zone) => zone}
                onValueChange={(value) => setDraft({ ...draft, timezone: value })}
              />
              <AdminFormEnumRow<EventFormat>
                id="event-create-format"
                label={t("adminEvents.list.create.formatLabel")}
                hint={t("adminEvents.list.create.formatHint")}
                value={asEventFormat(draft.format)}
                options={EVENT_FORMATS}
                labelFor={(format) => t(EVENT_FORMAT_LABEL_KEYS[format])}
                onValueChange={(value) => setDraft({ ...draft, format: value })}
              />
            </div>

            {/* Miejsce ZNIKA dla wydarzeń wyłącznie online - tak samo jak w bazie,
                która zeruje wtedy miasto i kraj. Pole, którego zapis jest z góry
                unieważniony, jest kontrolką kłamiącą o skutku. */}
            {asEventFormat(draft.format) === "online" ? null : (
              <div className="grid gap-3 sm:grid-cols-2">
                <AdminFormTextRow
                  id="event-create-city"
                  label={t("adminEvents.list.create.cityLabel")}
                  value={draft.city}
                  maxLength={160}
                  onValueChange={(value) => setDraft({ ...draft, city: value })}
                />
                <AdminFormTextRow
                  id="event-create-country"
                  label={t("adminEvents.list.create.countryLabel")}
                  hint={t("adminEvents.list.create.placeHint")}
                  value={draft.country}
                  maxLength={160}
                  onValueChange={(value) => setDraft({ ...draft, country: value })}
                />
              </div>
            )}

            {/* Pole POJAWIA SIĘ z trybu rodzaju, a nie stoi zawsze. Adres zapisów
                zewnętrznych jest wymagany dokładnie wtedy, gdy rodzaj zapisuje
                uczestników poza serwisem - pytanie o niego przy każdym innym
                rodzaju byłoby polem, którego nikt nigdy nie czyta. */}
            {registrationMode === "external" ? (
              <AdminFormTextRow
                id="event-create-external-url"
                label={t("adminEvents.list.create.externalUrlLabel")}
                hint={t("adminEvents.list.create.externalUrlHint")}
                value={draft.externalRegistrationUrl}
                type="url"
                maxLength={2048}
                onValueChange={(value) => setDraft({ ...draft, externalRegistrationUrl: value })}
              />
            ) : null}

            {selected === null ? null : (
              <dl className="grid gap-x-4 gap-y-1 rounded-md border border-border/60 bg-muted/40 p-3 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("adminEvents.types.dialog.formatLabel")}
                  </dt>
                  <dd>{t(EVENT_FORMAT_LABEL_KEYS[asEventFormat(selected.default_format)])}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("adminEvents.types.dialog.registrationModeLabel")}
                  </dt>
                  <dd>
                    {t(
                      EVENT_REGISTRATION_MODE_LABEL_KEYS[
                        asEventRegistrationMode(selected.default_registration_mode)
                      ],
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("adminEvents.types.dialog.registrationFlowLabel")}
                  </dt>
                  <dd>
                    {t(
                      EVENT_REGISTRATION_FLOW_LABEL_KEYS[
                        asEventRegistrationFlow(selected.default_registration_flow)
                      ],
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("adminEvents.types.dialog.guestModeLabel")}
                  </dt>
                  <dd>
                    {t(EVENT_GUEST_MODE_LABEL_KEYS[asEventGuestMode(selected.default_guest_mode)])}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("adminEvents.types.dialog.capacityLabel")}
                  </dt>
                  <dd>
                    {selected.default_capacity === null
                      ? t("adminEvents.list.row.noCapacity")
                      : selected.default_capacity}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t("adminEvents.types.dialog.minTierRankLabel")}
                  </dt>
                  <dd>{selected.default_min_tier_rank}</dd>
                </div>
              </dl>
            )}

            {issue === null ? null : (
              <p className="text-sm text-destructive" role="alert">
                {t(issue)}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={cancel}>
            {t("adminEvents.list.create.cancelAction")}
          </Button>
          <Button onClick={() => onSubmit(draft)} disabled={isSaving || noTypes || issue !== null}>
            {isSaving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {t("adminEvents.list.create.submitAction")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
