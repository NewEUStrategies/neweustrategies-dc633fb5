// Organizm: „Informacje ogolne" wydarzenia - pierwszy ekran studia.
//
// UKLAD JEST DWUKOLUMNOWY (opis po lewej, pola po prawej) i to nie jest
// kosmetyka: pol jest osiemnascie, a bez zdania wyjasniajacego przy kazdej
// sekcji redaktor nie wie, ktore z nich zobaczy uczestnik, a ktore sluza
// integracjom. Wzorzec referencyjny ma dokladnie ten uklad.
//
// TYTUL I OPIS MAJA PRZELACZNIK JEZYKA, A NIE DWA POLA OBOK SIEBIE. Dwa pola
// zajmuja dwa razy tyle miejsca i zachecaja do wklejenia tego samego tekstu
// dwa razy; przelacznik pokazuje, ze wersja angielska JEST osobna trescia.
//
// PODGLAD DOSTAJE SZKIC, NIE ZAPIS. Kazda zmiana w tym formularzu jest widoczna
// w doku podgladu natychmiast - o to chodzi w „podgladzie na zywo".
//
// ADRES PUBLICZNY JEST POD KLODKA. Zmiana slugu opublikowanego wydarzenia psuje
// linki w wyslanych e-mailach i w mediach spolecznosciowych, wiec pole jest
// zamkniete do momentu swiadomego klikniecia olowka.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Copy, Info, Pencil } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { AdminFormDateTimeRow } from "@/components/admin/molecules/AdminFormDateTimeRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { useSyncEventPreview } from "@/components/admin/events/studio/EventStudioPreviewContext";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import {
  EVENT_GENERAL_MAX_ADDRESS,
  EVENT_GENERAL_MAX_DESCRIPTION,
  EVENT_GENERAL_MAX_HASHTAG,
  EVENT_GENERAL_MAX_TITLE,
  EVENT_VIDEO_PLATFORMS,
  EVENT_VIDEO_PLATFORM_LABEL_KEYS,
  clearEventLocation,
  eventAddressLine,
  eventGeneralDirty,
  eventGeneralDraftFromRow,
  eventGeneralPayload,
  eventGeneralWarnings,
  parseVideoId,
  validateEventGeneralDraft,
  type EventGeneralDraft,
  type EventGeneralField,
  type EventVideoPlatform,
} from "@/lib/events/eventGeneralDraft";
import { eventLanguageOptions } from "@/lib/events/eventLanguages";
import { EVENT_FORMATS, EVENT_FORMAT_LABEL_KEYS, type EventFormat } from "@/lib/events/eventTypes";
import { useSaveEventGeneral } from "@/lib/events/useAdminEventDetail";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { timeZoneOptions } from "@/lib/events/timeZoneOptions";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/** Kolejnosc kart formatu jak we wzorcu: hybryda, na miejscu, online. */
const FORMAT_ORDER: readonly EventFormat[] = ["hybrid", "onsite", "online"];

export function EventGeneralPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  // Wiersz RPC jest typem generowanym (alias literalu obiektu), wiec wchodzi
  // wprost tam, gdzie modul czysty prosi o `Record<string, unknown>` - bez
  // rzutowania, ktore i tak zaslanialoby ewentualna zmiane ksztaltu RPC.
  const saved = useMemo(() => eventGeneralDraftFromRow(row), [row]);
  const [draft, setDraft] = useState<EventGeneralDraft>(saved);
  const [touched, setTouched] = useState(false);
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [textLang, setTextLang] = useState<"pl" | "en">(lang === "en" ? "en" : "pl");

  // Wiersz z serwera wygrywa po zapisie i po odswiezeniu - inaczej ekran
  // pokazywalby szkic sprzed zapisu jako „aktualny".
  useEffect(() => setDraft(saved), [saved]);

  const save = useSaveEventGeneral(row.id);
  const errors = validateEventGeneralDraft(draft);
  const warnings = eventGeneralWarnings(draft);
  const dirty = eventGeneralDirty(draft, saved);

  const set = <K extends keyof EventGeneralDraft>(key: K, value: EventGeneralDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const errorFor = (field: EventGeneralField): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  // Podglad na zywo dostaje TEN szkic, nie odpowiedz z bazy.
  useSyncEventPreview({
    titlePl: draft.titlePl,
    titleEn: draft.titleEn,
    slug: draft.slug,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    timezone: draft.timezone,
    format: draft.format,
    coverUrl: draft.coverUrl,
    videoPlatform: draft.videoPlatform,
    videoId: draft.videoId,
    locationName: draft.location,
    addressLine: eventAddressLine(draft),
    descriptionPl: draft.descriptionPl,
    descriptionEn: draft.descriptionEn,
    hashtag: draft.socialHashtag,
    languages: draft.languages,
    supportEmail: draft.supportEmail,
  });

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    save.mutate(eventGeneralPayload(row.id, draft), {
      onSuccess: () => {
        toast.success(t("adminEvents.studio.toasts.generalSaved"));
        setSlugUnlocked(false);
      },
      onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
    });
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const languages = eventLanguageOptions(i18n.language);
  const zones = timeZoneOptions(draft.timezone);

  const copyId = () => {
    void navigator.clipboard?.writeText(row.id).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error(t("adminEvents.studio.general.copyFailed")),
    );
  };

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.general")}>
      {/* ------------------------------------------------------ Podstawy */}
      <EventStudioRow
        label={t("adminEvents.studio.general.basics")}
        description={t("adminEvents.studio.general.basicsDescription")}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="event-name">{t("adminEvents.studio.general.nameLabel")}</Label>
            <LangToggle value={textLang} onChange={setTextLang} />
          </div>
          <Input
            id="event-name"
            value={textLang === "pl" ? draft.titlePl : draft.titleEn}
            maxLength={EVENT_GENERAL_MAX_TITLE}
            onChange={(event) => set(textLang === "pl" ? "titlePl" : "titleEn", event.target.value)}
            aria-invalid={errorFor(textLang === "pl" ? "titlePl" : "titleEn") !== null}
          />
          {errorFor("titlePl") === null && errorFor("titleEn") === null ? null : (
            <p className="text-xs text-destructive" role="alert">
              {t("adminEvents.general.errors.titleRequired")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="event-slug">{t("adminEvents.studio.general.urlLabel")}</Label>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <span className="shrink-0 text-[13px] text-muted-foreground">{origin}/events/</span>
            <input
              id="event-slug"
              value={draft.slug}
              readOnly={!slugUnlocked}
              onChange={(event) => set("slug", event.target.value.toLowerCase())}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={t("adminEvents.studio.general.editUrl")}
              onClick={() => setSlugUnlocked((value) => !value)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          {errorFor("slug") === null ? (
            <p className="text-xs text-muted-foreground">
              {t("adminEvents.studio.general.urlHint")}
            </p>
          ) : (
            <p className="text-xs text-destructive" role="alert">
              {errorFor("slug")}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <AdminFormDateTimeRow
            id="event-begins"
            label={t("adminEvents.studio.general.beginsLabel")}
            value={draft.startsAt}
            error={errorFor("startsAt")}
            onValueChange={(value) => set("startsAt", value)}
          />
          <AdminFormDateTimeRow
            id="event-ends"
            label={t("adminEvents.studio.general.endsLabel")}
            value={draft.endsAt}
            error={errorFor("endsAt")}
            onValueChange={(value) => set("endsAt", value)}
          />
          <AdminFormEnumRow<string>
            id="event-timezone"
            label={t("adminEvents.studio.general.timeZoneLabel")}
            value={draft.timezone}
            options={zones}
            labelFor={(zone) => zone}
            onValueChange={(value) => set("timezone", value)}
          />
        </div>
      </EventStudioRow>

      {/* ------------------------------------------------------- Okladka */}
      <EventStudioRow
        label={t("adminEvents.studio.general.cover")}
        description={t("adminEvents.studio.general.coverDescription")}
      >
        <CoverImagePicker
          label={t("adminEvents.studio.general.coverLabel")}
          value={draft.coverUrl}
          onChange={(value) => set("coverUrl", value ?? "")}
          folder="events"
        />
        {errorFor("coverUrl") === null ? null : (
          <p className="text-xs text-destructive" role="alert">
            {errorFor("coverUrl")}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <AdminFormEnumRow<EventVideoPlatform>
            id="event-video-platform"
            label={t("adminEvents.studio.general.videoPlatformLabel")}
            value={draft.videoPlatform}
            options={EVENT_VIDEO_PLATFORMS}
            labelFor={(platform) => t(EVENT_VIDEO_PLATFORM_LABEL_KEYS[platform])}
            onValueChange={(value) => set("videoPlatform", value)}
          />
          <div className="space-y-1.5">
            <Label htmlFor="event-video-id">{t("adminEvents.studio.general.videoIdLabel")}</Label>
            <Input
              id="event-video-id"
              value={draft.videoId}
              placeholder={t("adminEvents.studio.general.videoIdPlaceholder")}
              onChange={(event) => set("videoId", event.target.value)}
              onBlur={(event) =>
                set("videoId", parseVideoId(event.target.value, draft.videoPlatform))
              }
            />
            <p className="text-xs text-muted-foreground">
              {t("adminEvents.studio.general.videoIdHint")}
            </p>
          </div>
        </div>
      </EventStudioRow>

      {/* -------------------------------------------------------- Format */}
      <EventStudioRow
        label={t("adminEvents.studio.general.format")}
        description={t("adminEvents.studio.general.formatDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {FORMAT_ORDER.filter((format) => EVENT_FORMATS.includes(format)).map((format) => (
            <EventStudioChoiceCard
              key={format}
              id={`event-format-${format}`}
              name="event-format"
              checked={draft.format === format}
              label={t(EVENT_FORMAT_LABEL_KEYS[format])}
              onSelect={() => set("format", format)}
            />
          ))}
        </div>
      </EventStudioRow>

      {/* ----------------------------------------------------- Lokalizacja */}
      <EventStudioRow
        label={t("adminEvents.studio.general.location")}
        description={t("adminEvents.studio.general.locationDescription")}
      >
        <Field
          id="event-location"
          label={t("adminEvents.studio.general.venueLabel")}
          value={draft.location}
          onChange={(value) => set("location", value)}
        />
        <Field
          id="event-street"
          label={t("adminEvents.studio.general.streetLabel")}
          value={draft.streetAddress}
          onChange={(value) => set("streetAddress", value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="event-city"
            label={t("adminEvents.studio.general.cityLabel")}
            value={draft.city}
            onChange={(value) => set("city", value)}
          />
          <Field
            id="event-region"
            label={t("adminEvents.studio.general.regionLabel")}
            value={draft.region}
            onChange={(value) => set("region", value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="event-postal"
            label={t("adminEvents.studio.general.postalLabel")}
            value={draft.postalCode}
            onChange={(value) => set("postalCode", value)}
          />
          <Field
            id="event-country"
            label={t("adminEvents.studio.general.countryLabel")}
            value={draft.country}
            onChange={(value) => set("country", value)}
          />
        </div>
        <button
          type="button"
          onClick={() => setDraft(clearEventLocation(draft))}
          className="text-xs text-brand underline underline-offset-2"
        >
          {t("adminEvents.studio.general.resetLocation")}
        </button>
      </EventStudioRow>

      {/* ---------------------------------------------------- Informacje */}
      <EventStudioRow
        label={t("adminEvents.studio.general.information")}
        description={t("adminEvents.studio.general.informationDescription")}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="event-description">
              {t("adminEvents.studio.general.informationLabel")}
            </Label>
            <LangToggle value={textLang} onChange={setTextLang} />
          </div>
          <Textarea
            id="event-description"
            rows={8}
            maxLength={EVENT_GENERAL_MAX_DESCRIPTION}
            value={textLang === "pl" ? draft.descriptionPl : draft.descriptionEn}
            onChange={(event) =>
              set(textLang === "pl" ? "descriptionPl" : "descriptionEn", event.target.value)
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEvents.studio.general.informationHint")}
          </p>
        </div>
      </EventStudioRow>

      {/* ------------------------------------------------------- Hashtag */}
      <EventStudioRow
        label={t("adminEvents.studio.general.hashtag")}
        description={t("adminEvents.studio.general.hashtagDescription")}
      >
        <div className="space-y-1.5">
          <Label htmlFor="event-hashtag">{t("adminEvents.studio.general.hashtagLabel")}</Label>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <span className="text-[13px] text-muted-foreground">#</span>
            <input
              id="event-hashtag"
              value={draft.socialHashtag}
              maxLength={EVENT_GENERAL_MAX_HASHTAG}
              placeholder={t("adminEvents.studio.general.hashtagPlaceholder")}
              onChange={(event) => set("socialHashtag", event.target.value.replace(/^#+/, ""))}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
          </div>
          {errorFor("socialHashtag") === null ? null : (
            <p className="text-xs text-destructive" role="alert">
              {errorFor("socialHashtag")}
            </p>
          )}
        </div>
      </EventStudioRow>

      {/* -------------------------------------------------------- Jezyki */}
      <EventStudioRow
        label={t("adminEvents.studio.general.languages")}
        description={t("adminEvents.studio.general.languagesDescription")}
        hint={
          <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("adminEvents.studio.general.languagesHint")}
          </p>
        }
      >
        <div
          role="group"
          aria-label={t("adminEvents.studio.general.languages")}
          className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-3"
        >
          {languages.map((option) => {
            const checked = draft.languages.includes(option.code);
            return (
              <label
                key={option.code}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-muted"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) =>
                    set(
                      "languages",
                      next === true
                        ? [...draft.languages, option.code]
                        : draft.languages.filter((code) => code !== option.code),
                    )
                  }
                />
                {option.label}
              </label>
            );
          })}
        </div>
        {errorFor("languages") === null ? null : (
          <p className="text-xs text-destructive" role="alert">
            {errorFor("languages")}
          </p>
        )}
      </EventStudioRow>

      {/* --------------------------------------------------- Adres wsparcia */}
      <EventStudioRow
        label={t("adminEvents.studio.general.support")}
        description={t("adminEvents.studio.general.supportDescription")}
      >
        <Field
          id="event-support-email"
          label={t("adminEvents.studio.general.supportLabel")}
          value={draft.supportEmail}
          type="email"
          error={errorFor("supportEmail")}
          onChange={(value) => set("supportEmail", value)}
        />
      </EventStudioRow>

      {/* ----------------------------------------------- Identyfikator */}
      <EventStudioRow
        label={t("adminEvents.studio.general.eventId")}
        description={t("adminEvents.studio.general.eventIdDescription")}
      >
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
            {row.id}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={t("adminEvents.studio.general.copyId")}
            onClick={copyId}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
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

function LangToggle({
  value,
  onChange,
}: {
  value: "pl" | "en";
  onChange: (value: "pl" | "en") => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-border"
      role="group"
      aria-label={t("adminEvents.studio.general.contentLanguage")}
    >
      {(["pl", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={value === code}
          onClick={() => onChange(code)}
          className={
            "px-2 py-0.5 text-[11px] font-medium uppercase " +
            (value === code ? "bg-brand/10 text-brand" : "text-muted-foreground hover:bg-muted")
          }
        >
          {code}
        </button>
      ))}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        maxLength={EVENT_GENERAL_MAX_ADDRESS}
        aria-invalid={error === null || error === undefined ? undefined : true}
        onChange={(event) => onChange(event.target.value)}
      />
      {error === null || error === undefined ? null : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
