// Organizm: „Branding" wydarzenia.
//
// SLOT PUSTY = DZIEDZICZENIE Z MOTYWU SERWISU. To jest cala mechanika tego
// ekranu i dlatego „Przywroc branding spolecznosci" CZYSCI wartosci, zamiast
// wpisywac dzisiejsze kolory motywu: wydarzenie z zapisana kopia kolorow
// przestaloby reagowac na zmiane marki i po pol roku wygladalo by jak archiwum.
//
// PODGLAD JEST TU WARUNKIEM UZYTECZNOSCI, nie dodatkiem. Sześciocyfrowy kod
// koloru nie mowi nic o tym, czy tekst bedzie czytelny na tle bloku - dopiero
// rysunek strony to pokazuje. Dlatego kazda zmiana idzie do doku podgladu
// natychmiast, przed zapisem.
//
// ZAKRES SLOTOW JEST WASKI (pieć kolorow i obraz tla). Branding wydarzenia to
// nie drugi edytor motywu; kazdy dodatkowy slot to kolejny sposob na zlozenie
// strony nieczytelnej, a globalne kolory maja wlasny ekran w panelu.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { useSyncEventPreview } from "@/components/admin/events/studio/EventStudioPreviewContext";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import {
  EMPTY_EVENT_BRANDING,
  EVENT_BRANDING_SLOT_HINT_KEYS,
  EVENT_BRANDING_SLOT_LABEL_KEYS,
  eventBrandingDirty,
  eventBrandingFromJson,
  eventBrandingPayload,
  validateEventBranding,
  type EventBrandingColorSlot,
  type EventBrandingDraft,
} from "@/lib/events/eventBrandingDraft";
import { useSaveEventBranding } from "@/lib/events/useAdminEventDetail";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/** Kolory z pierwszej sekcji ekranu; tlo ma wlasna sekcje - jak we wzorcu. */
const PRIMARY_SLOTS: readonly EventBrandingColorSlot[] = ["navigation", "main_action", "text"];
const BACKGROUND_SLOTS: readonly EventBrandingColorSlot[] = [
  "blocks_background",
  "page_background",
];

export function EventBrandingPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();

  const saved = useMemo(() => eventBrandingFromJson(row.branding), [row.branding]);
  const [draft, setDraft] = useState<EventBrandingDraft>(saved);
  useEffect(() => setDraft(saved), [saved]);

  const save = useSaveEventBranding(row.id);
  const errors = validateEventBranding(draft);
  const dirty = eventBrandingDirty(draft, saved);

  useSyncEventPreview({ branding: draft });

  const setColor = (slot: EventBrandingColorSlot, value: string) =>
    setDraft((previous) => ({ ...previous, colors: { ...previous.colors, [slot]: value } }));

  const errorFor = (slot: EventBrandingColorSlot | "backgroundImage"): string | null => {
    const found = errors.find((error) => error.slot === slot);
    return found === undefined ? null : t(found.messageKey);
  };

  const submit = () => {
    if (errors.length > 0) return;
    save.mutate(eventBrandingPayload(draft), {
      onSuccess: () => toast.success(t("adminEvents.studio.toasts.brandingSaved")),
      onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
    });
  };

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.branding")}>
      <EventStudioRow
        label={t("adminEvents.branding.appearance")}
        description={t("adminEvents.branding.appearanceDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <EventStudioChoiceCard
            id="event-appearance-light"
            name="event-appearance"
            checked={draft.appearance === "light"}
            label={t("adminEvents.branding.light")}
            onSelect={() => setDraft({ ...draft, appearance: "light" })}
          >
            <AppearanceSample dark={false} />
          </EventStudioChoiceCard>
          <EventStudioChoiceCard
            id="event-appearance-dark"
            name="event-appearance"
            checked={draft.appearance === "dark"}
            label={t("adminEvents.branding.dark")}
            onSelect={() => setDraft({ ...draft, appearance: "dark" })}
          >
            <AppearanceSample dark />
          </EventStudioChoiceCard>
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.branding.colors")}
        description={t("adminEvents.branding.colorsDescription")}
      >
        {PRIMARY_SLOTS.map((slot) => (
          <ColorField
            key={slot}
            slot={slot}
            value={draft.colors[slot]}
            error={errorFor(slot)}
            onChange={(value) => setColor(slot, value)}
          />
        ))}
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.branding.background")}
        description={t("adminEvents.branding.backgroundDescription")}
      >
        {BACKGROUND_SLOTS.map((slot) => (
          <ColorField
            key={slot}
            slot={slot}
            value={draft.colors[slot]}
            error={errorFor(slot)}
            onChange={(value) => setColor(slot, value)}
          />
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="event-branding-image">
            {t("adminEvents.branding.backgroundImageLabel")}
          </Label>
          <Input
            id="event-branding-image"
            value={draft.backgroundImage}
            placeholder="https://"
            onChange={(event) => setDraft({ ...draft, backgroundImage: event.target.value })}
          />
          {errorFor("backgroundImage") === null ? (
            <p className="text-xs text-muted-foreground">
              {t("adminEvents.branding.backgroundImageHint")}
            </p>
          ) : (
            <p className="text-xs text-destructive" role="alert">
              {errorFor("backgroundImage")}
            </p>
          )}
        </div>
      </EventStudioRow>

      <EventStudioSaveBar
        dirty={dirty}
        saving={save.isPending}
        disabled={errors.length > 0}
        saveLabel={t("adminEvents.studio.actions.save")}
        discardLabel={t("adminEvents.studio.actions.discard")}
        savingLabel={t("adminEvents.studio.actions.saving")}
        onSave={submit}
        onDiscard={() => setDraft(saved)}
        leading={
          <button
            type="button"
            onClick={() =>
              setDraft({ ...EMPTY_EVENT_BRANDING, colors: { ...EMPTY_EVENT_BRANDING.colors } })
            }
            className="text-xs text-brand underline underline-offset-2"
          >
            {t("adminEvents.branding.resetToCommunity")}
          </button>
        }
      />
    </EventStudioPage>
  );
}

function ColorField({
  slot,
  value,
  error,
  onChange,
}: {
  slot: EventBrandingColorSlot;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = `event-branding-${slot}`;
  // Pusty slot pokazuje w probniku barwe neutralna, ale NIE zapisuje jej -
  // dopiero swiadoma zmiana koloru nadpisuje dziedziczenie.
  const swatch = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#FFFFFF";
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(EVENT_BRANDING_SLOT_LABEL_KEYS[slot])}</Label>
      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
        <span className="text-[13px] text-muted-foreground">#</span>
        <input
          id={id}
          value={value.replace(/^#/, "")}
          placeholder={t("adminEvents.branding.inheritedPlaceholder")}
          onChange={(event) => {
            const raw = event.target.value.trim().replace(/^#/, "");
            onChange(raw === "" ? "" : `#${raw.toUpperCase()}`);
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] uppercase outline-none"
        />
        <input
          type="color"
          value={swatch}
          aria-label={t(EVENT_BRANDING_SLOT_LABEL_KEYS[slot])}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        />
      </div>
      {error === null ? (
        <p className="text-xs text-muted-foreground">{t(EVENT_BRANDING_SLOT_HINT_KEYS[slot])}</p>
      ) : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Miniatura wizytowki uczestnika - ten sam podglad, co we wzorcu. */
function AppearanceSample({ dark }: { dark: boolean }) {
  return (
    <span
      className="mt-3 flex flex-col items-center gap-1 rounded-md p-4"
      style={{ background: dark ? "#0B1120" : "#FFFFFF", color: dark ? "#F5F7FA" : "#01112F" }}
    >
      <span className="h-8 w-8 rounded-full bg-current opacity-20" />
      <span className="text-[11px] font-semibold">Jane Doe</span>
      <span className="text-[10px] opacity-70">Policy Analyst</span>
    </span>
  );
}
