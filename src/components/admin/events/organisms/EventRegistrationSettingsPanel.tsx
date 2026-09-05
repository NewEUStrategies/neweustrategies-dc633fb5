// Organizm: „Ustawienia rejestracji" - pierwszy ekran grupy „Rejestracja w aplikacji".
//
// PO CO TEN EKRAN ISTNIEJE. Tryb zapisow, przebieg, widocznosc, limit miejsc,
// prog warstwy, cena wejsciowki oraz adres transmisji i nagrania dawaly sie do
// tej zmiany ustawic WYLACZNIE w starym dialogu `/admin/community/events` - czyli
// studio pytalo o tytul i termin, a o to, czy w ogole da sie zapisac, pytal inny
// formularz w innej sekcji panelu. Dwa formularze na te same kolumny, z ktorych
// jeden nie widzi polowy pol, to dokladnie ten dlug, ktory studio mialo zlikwidowac.
//
// UKLAD DWUKOLUMNOWY (opis po lewej, pola po prawej) nie jest kosmetyka: kazde
// z tych pol zmienia to, CO SIE STANIE, gdy uczestnik kliknie „Zapisz sie", a to
// nie wynika z samej nazwy pola. Zdanie przy sekcji jest czescia kontrolki.
//
// TEN EKRAN NIE KARMI PODGLADU NA ZYWO i dlatego nie ma tu `useSyncEventPreview`.
// Dok podgladu rysuje WYGLAD strony wydarzenia - naglowek, okladke, opis, adres.
// Zaden z tych dziesieciu parametrow wygladu nie zmienia: tryb zapisow decyduje,
// jaki formularz stoi za przyciskiem, a limit miejsc i prog warstwy sa regulami
// dostepu liczonymi po stronie bazy (`get_event_access`). Podpiecie ich do
// podgladu obiecywaloby, ze zobaczymy tam skutek zmiany - a nie zobaczymy, bo
// podglad renderuje szkic, nie sesje uczestnika o danej warstwie.
//
// ADRES TRANSMISJI I NAGRANIA MOZNA TU POKAZAC tylko dlatego, ze wiersz
// przychodzi z `admin_event_detail`: oba adresy sa odciete od klienckiego
// SELECT-a grantem kolumnowym, a to RPC jest definerowe i stoi za asercja roli
// redaktora w tenancie domowym. Zwyklym zapytaniem redaktor moglby je zapisac
// na slepo, ale nie odczytac.
//
// POLE ADRESU ZEWNETRZNEGO POJAWIA SIE W TRYBIE `external` - ORAZ WSZEDZIE TAM,
// GDZIE TEN ADRES BLOKUJE ZAPIS. Pole, ktorego nikt nigdy nie czyta, jest polem,
// ktore ktos kiedys wypelni przez pomylke - a wtedy zapis ma sie udac, bo baza
// nie zeruje adresu przy zmianie trybu. To jednak dotyczy adresu POPRAWNEGO:
// adres w zlym ksztalcie lamie CHECK `events_external_registration_url_https`
// w KAZDYM trybie, wiec `validateRegistrationSettingsDraft` gasi „Zapisz" takze
// przy `rsvp`. Zgaszony przycisk bez pola i bez czerwonego zdania jest blokada
// bez powodu na ekranie - dlatego pole wraca razem ze swoim komunikatem.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Info } from "@/lib/lucide-shim";
import { AdminFormDateTimeRow } from "@/components/admin/molecules/AdminFormDateTimeRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import {
  EVENT_REGISTRATION_FLOW_HINT_KEYS,
  EVENT_REGISTRATION_MODE_HINT_KEYS,
  EVENT_VISIBILITIES,
  EVENT_VISIBILITY_HINT_KEYS,
  EVENT_VISIBILITY_LABEL_KEYS,
  REGISTRATION_SETTINGS_MAX_URL,
  TICKET_CURRENCIES,
  registrationSettingsDirty,
  registrationSettingsDraftFromRow,
  registrationSettingsPayload,
  registrationSettingsWarnings,
  validateRegistrationSettingsDraft,
  type EventVisibility,
  type RegistrationSettingsDraft,
  type RegistrationSettingsField,
  type TicketCurrency,
} from "@/lib/events/registrationSettingsDraft";
import {
  EVENT_REGISTRATION_FLOWS,
  EVENT_REGISTRATION_FLOW_LABEL_KEYS,
  EVENT_REGISTRATION_MODES,
  EVENT_REGISTRATION_MODE_LABEL_KEYS,
  asEventFormat,
  type EventRegistrationFlow,
  type EventRegistrationMode,
} from "@/lib/events/eventTypes";
import { useSaveEventGeneral } from "@/lib/events/useAdminEventDetail";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/**
 * Kolejnosc kart trybu od NAJWIEKSZEJ do NAJMNIEJSZEJ obslugi po naszej stronie:
 * jedno klikniecie, formularz, cudzy serwis, brak zapisow. Kolejnosc tablicy
 * enuma zaczyna sie tak samo, ale nie jest gwarantowana - a karta „Bez zapisow"
 * ma stac na koncu, bo jest wyjsciem, nie wyborem domyslnym.
 */
const MODE_ORDER: readonly EventRegistrationMode[] = ["rsvp", "form", "external", "none"];
const FLOW_ORDER: readonly EventRegistrationFlow[] = ["instant", "approval"];

export function EventRegistrationSettingsPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();

  // Wiersz RPC jest typem generowanym (alias literalu obiektu), wiec wchodzi
  // wprost tam, gdzie modul czysty prosi o `Record<string, unknown>` - bez
  // rzutowania, ktore i tak zaslanialoby ewentualna zmiane ksztaltu RPC.
  const saved = useMemo(() => registrationSettingsDraftFromRow(row), [row]);
  const [draft, setDraft] = useState<RegistrationSettingsDraft>(saved);
  const [touched, setTouched] = useState(false);

  // Wiersz z serwera wygrywa po zapisie i po odswiezeniu - inaczej ekran
  // pokazywalby szkic sprzed zapisu jako „aktualny".
  useEffect(() => setDraft(saved), [saved]);

  const save = useSaveEventGeneral(row.id);
  const errors = validateRegistrationSettingsDraft(draft);
  // FORMAT NIE JEST EDYTOWANY TUTAJ - przychodzi z wiersza, bo ostrzezenie
  // „online bez adresu transmisji" jest zdaniem o PARZE ustawien z dwoch ekranow.
  const warnings = registrationSettingsWarnings(draft, asEventFormat(row.format));
  // LADUNEK GUBI KWOTE NIECZYTELNA - zamienia ja na PUSTY NAPIS, czyli na to
  // samo, co niesie pole puste. Samo porownanie ladunkow uznaje wiec „dwiescie"
  // wpisane w wydarzeniu bezplatnym za brak zmiany: pasek zapisu nie wstaje,
  // `touched` zostaje na `false`, a wtedy i czerwone zdanie nie ma sie kiedy
  // pokazac. Szkic, ktorego baza by nie przyjela, JEST zmiana warta paska.
  const dirty = registrationSettingsDirty(draft, saved) || errors.length > 0;

  // Tryb „bez zapisow" nie zbiera zgloszen, wiec limit miejsc nie ma czego
  // odcinac. Wartosc zostaje w szkicu i w ladunku (baza jej nie zeruje, a powrot
  // do zapisow ma odzyskac pule), ale pole jest zgaszone i mowi dlaczego.
  const withoutSignups = draft.registrationMode === "none";

  // Adres zewnetrzny w zlym ksztalcie blokuje zapis w KAZDYM trybie, wiec pole
  // musi stanac na ekranie takze poza `external` - inaczej redaktor ma zgaszony
  // przycisk i ani jednego pola do poprawienia.
  const externalUrlRejected = errors.some((error) => error.field === "externalRegistrationUrl");

  // TA SAMA ZASADA DLA LIMITU. CHECK `capacity IS NULL OR capacity > 0` obowiazuje
  // w kazdym trybie, wiec odrzucona wartosc gasi „Zapisz" takze przy „bez zapisow".
  // Pole zgaszone z czerwonym zdaniem pod spodem byloby wtedy blokada, ktorej
  // redaktor nie ma jak odblokowac - gasimy je dopiero, gdy nie ma czego poprawiac.
  const capacityRejected = errors.some((error) => error.field === "capacity");

  const set = <K extends keyof RegistrationSettingsDraft>(
    key: K,
    value: RegistrationSettingsDraft[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));

  const errorFor = (field: RegistrationSettingsField): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    save.mutate(registrationSettingsPayload(row.id, draft), {
      onSuccess: () => toast.success(t("adminEvents.studio.toasts.registrationSettingsSaved")),
      onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
    });
  };

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.registrationSettings")}>
      {/* --------------------------------------------------- Tryb zapisow */}
      <EventStudioRow
        label={t("adminEvents.studio.registrationSettings.mode")}
        description={t("adminEvents.studio.registrationSettings.modeDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {MODE_ORDER.filter((mode) => EVENT_REGISTRATION_MODES.includes(mode)).map((mode) => (
            <EventStudioChoiceCard
              key={mode}
              id={`event-registration-mode-${mode}`}
              name="event-registration-mode"
              checked={draft.registrationMode === mode}
              label={t(EVENT_REGISTRATION_MODE_LABEL_KEYS[mode])}
              description={t(EVENT_REGISTRATION_MODE_HINT_KEYS[mode])}
              onSelect={() => set("registrationMode", mode)}
            />
          ))}
        </div>

        {draft.registrationMode === "external" || externalUrlRejected ? (
          <AdminFormTextRow
            id="event-external-registration-url"
            label={t("adminEvents.studio.registrationSettings.externalUrlLabel")}
            value={draft.externalRegistrationUrl}
            type="url"
            maxLength={REGISTRATION_SETTINGS_MAX_URL}
            hint={t("adminEvents.studio.registrationSettings.externalUrlHint")}
            error={errorFor("externalRegistrationUrl")}
            onValueChange={(value) => set("externalRegistrationUrl", value)}
          />
        ) : null}
      </EventStudioRow>

      {/* -------------------------------------------------------- Przebieg */}
      <EventStudioRow
        label={t("adminEvents.studio.registrationSettings.flow")}
        description={t("adminEvents.studio.registrationSettings.flowDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {FLOW_ORDER.filter((flow) => EVENT_REGISTRATION_FLOWS.includes(flow)).map((flow) => (
            <EventStudioChoiceCard
              key={flow}
              id={`event-registration-flow-${flow}`}
              name="event-registration-flow"
              checked={draft.registrationFlow === flow}
              label={t(EVENT_REGISTRATION_FLOW_LABEL_KEYS[flow])}
              description={t(EVENT_REGISTRATION_FLOW_HINT_KEYS[flow])}
              onSelect={() => set("registrationFlow", flow)}
            />
          ))}
        </div>
      </EventStudioRow>

      {/* ---------------------------------------------------------- Dostep */}
      <EventStudioRow
        label={t("adminEvents.studio.registrationSettings.access")}
        description={t("adminEvents.studio.registrationSettings.accessDescription")}
        hint={
          <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("adminEvents.studio.registrationSettings.accessHint")}
          </p>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {EVENT_VISIBILITIES.map((visibility: EventVisibility) => (
            <EventStudioChoiceCard
              key={visibility}
              id={`event-visibility-${visibility}`}
              name="event-visibility"
              checked={draft.visibility === visibility}
              label={t(EVENT_VISIBILITY_LABEL_KEYS[visibility])}
              description={t(EVENT_VISIBILITY_HINT_KEYS[visibility])}
              onSelect={() => set("visibility", visibility)}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <AdminFormTextRow
            id="event-min-tier-rank"
            label={t("adminEvents.studio.registrationSettings.minTierLabel")}
            value={draft.minTierRank}
            inputMode="numeric"
            hint={t("adminEvents.studio.registrationSettings.minTierHint")}
            error={errorFor("minTierRank")}
            onValueChange={(value) => set("minTierRank", value)}
          />
          <AdminFormTextRow
            id="event-early-rsvp-rank"
            label={t("adminEvents.studio.registrationSettings.earlyRankLabel")}
            value={draft.earlyRsvpRank}
            inputMode="numeric"
            hint={t("adminEvents.studio.registrationSettings.earlyRankHint")}
            error={errorFor("earlyRsvpRank")}
            onValueChange={(value) => set("earlyRsvpRank", value)}
          />
        </div>

        <AdminFormDateTimeRow
          id="event-rsvp-opens-at"
          label={t("adminEvents.studio.registrationSettings.rsvpOpensLabel")}
          value={draft.rsvpOpensAt}
          hint={t("adminEvents.studio.registrationSettings.rsvpOpensHint")}
          error={errorFor("rsvpOpensAt")}
          onValueChange={(value) => set("rsvpOpensAt", value)}
        />

        <AdminFormSwitchRow
          id="event-chatham-house"
          label={t("adminEvents.studio.registrationSettings.chathamHouseLabel")}
          hint={t("adminEvents.studio.registrationSettings.chathamHouseHint")}
          checked={draft.chathamHouse}
          onCheckedChange={(checked) => set("chathamHouse", checked)}
        />
      </EventStudioRow>

      {/* -------------------------------------------------- Miejsca i cena */}
      <EventStudioRow
        label={t("adminEvents.studio.registrationSettings.seats")}
        description={t("adminEvents.studio.registrationSettings.seatsDescription")}
      >
        <AdminFormTextRow
          id="event-capacity"
          label={t("adminEvents.studio.registrationSettings.capacityLabel")}
          value={draft.capacity}
          inputMode="numeric"
          disabled={withoutSignups && !capacityRejected}
          hint={t(
            withoutSignups
              ? "adminEvents.studio.registrationSettings.capacityWithoutSignupsHint"
              : "adminEvents.studio.registrationSettings.capacityHint",
          )}
          error={errorFor("capacity")}
          onValueChange={(value) => set("capacity", value)}
        />

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
          {/* CENA W JEDNOSTKACH GLOWNYCH, nie w groszach. „250,00" jest tym, co
              redaktor widzi na fakturze; przeliczenie na grosze robi
              `registrationSettingsPayload`, bo pole tekstowe nie ma jak oddac
              kwoty inaczej niz napisem. */}
          <AdminFormTextRow
            id="event-ticket-price"
            label={t("adminEvents.studio.registrationSettings.priceLabel")}
            value={draft.ticketPrice}
            inputMode="decimal"
            hint={t("adminEvents.studio.registrationSettings.priceHint")}
            error={errorFor("ticketPrice")}
            onValueChange={(value) => set("ticketPrice", value)}
          />
          <AdminFormEnumRow<TicketCurrency>
            id="event-ticket-currency"
            label={t("adminEvents.studio.registrationSettings.currencyLabel")}
            value={draft.ticketCurrency}
            options={TICKET_CURRENCIES}
            labelFor={(currency) => currency}
            onValueChange={(value) => set("ticketCurrency", value)}
          />
        </div>
      </EventStudioRow>

      {/* --------------------------------------------- Transmisja i nagranie */}
      <EventStudioRow
        label={t("adminEvents.studio.registrationSettings.stream")}
        description={t("adminEvents.studio.registrationSettings.streamDescription")}
      >
        <AdminFormTextRow
          id="event-join-url"
          label={t("adminEvents.studio.registrationSettings.joinUrlLabel")}
          value={draft.joinUrl}
          type="url"
          maxLength={REGISTRATION_SETTINGS_MAX_URL}
          hint={t("adminEvents.studio.registrationSettings.joinUrlHint")}
          error={errorFor("joinUrl")}
          onValueChange={(value) => set("joinUrl", value)}
        />
        <AdminFormTextRow
          id="event-recording-url"
          label={t("adminEvents.studio.registrationSettings.recordingUrlLabel")}
          value={draft.recordingUrl}
          type="url"
          maxLength={REGISTRATION_SETTINGS_MAX_URL}
          hint={t("adminEvents.studio.registrationSettings.recordingUrlHint")}
          error={errorFor("recordingUrl")}
          onValueChange={(value) => set("recordingUrl", value)}
        />
      </EventStudioRow>

      {warnings.length === 0 ? null : (
        <ul className="space-y-1 py-4 text-xs text-amber-600 dark:text-amber-400">
          {warnings.map((warning) => (
            <li key={warning}>{t(warning)}</li>
          ))}
        </ul>
      )}

      <EventStudioSaveBar
        dirty={dirty}
        saving={save.isPending}
        disabled={touched && errors.length > 0}
        saveLabel={t("adminEvents.studio.actions.save")}
        discardLabel={t("adminEvents.studio.actions.discard")}
        savingLabel={t("adminEvents.studio.actions.saving")}
        onSave={submit}
        onDiscard={() => {
          setDraft(saved);
          setTouched(false);
        }}
      />
    </EventStudioPage>
  );
}
