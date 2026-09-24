// Pola KARTY PRELEGENTA rozwijanej kliknieciem - wspolne dla popupu „Nowy
// prelegent" i dialogu „Karta" przy wpisie na liscie.
//
// PO CO WSPOLNE. Te same piec pol zasila jedna karte na stronie prelegentow
// (`SpeakerProfileCard`). Dwie kopie formularza rozjechalyby sie przy
// pierwszej zmianie (limit etykiety w jednym miejscu, walidacja adresu
// w drugim) - a redaktor zakladajacy prelegenta i redaktor poprawiajacy karte
// musza widziec te same reguly.
//
// WALIDACJA PRZED ZAPISEM, BAZA NA KONCU. `speakerCardDraftErrors` jest
// lustrem CHECK-ow z migracji 20260924120000: redaktor widzi blad przy polu,
// zanim wysle formularz; odmowa bazy zostaje ostatnia linia obrony.
//
// KOLOR: natywny wybierak + pole #RRGGBB. Wybierak nie umie byc pusty, a pusty
// kolor znaczy „kolor marki wydarzenia" - dlatego obok stoi przycisk powrotu do
// koloru marki, a wybierak pokazuje kolor marki, dopoki redaktor nic nie wybral.
import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EventImageDropzone } from "@/components/admin/events/atoms/EventImageDropzone";
import {
  SPEAKER_CARD_LABEL_MAX,
  hexColorOrNull,
  speakerCardDraftErrors,
  type SpeakerCardDraft,
} from "@/lib/events/speakerCard";
import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";
// Pole zdjecia to `EventImageDropzone`, ktory mowi slownikiem agendy - bez tej
// rejestracji napisy obszaru wgrywania bylyby kluczami na ekranie prelegentow.
import "@/lib/i18n-admin-event-agenda";

ensureCommunityEventsI18n();

/** Kolor pokazywany w wybieraku, dopoki redaktor nie wybral wlasnego. */
const PICKER_FALLBACK = "#fa9346";

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (message === null) return null;
  return (
    <p id={id} role="alert" className="text-[11px] leading-snug text-destructive">
      {message}
    </p>
  );
}

export function EventSpeakerCardFields({
  idPrefix,
  value,
  onChange,
}: {
  /** Przedrostek identyfikatorow pol - dwa formularze na jednej stronie. */
  idPrefix: string;
  value: SpeakerCardDraft;
  onChange: (next: SpeakerCardDraft) => void;
}) {
  const { t } = useTranslation();
  const errors = speakerCardDraftErrors(value);
  const set = <K extends keyof SpeakerCardDraft>(key: K, next: SpeakerCardDraft[K]): void => {
    onChange({ ...value, [key]: next });
  };
  const message = (key: keyof SpeakerCardDraft): string | null => {
    const code = errors[key];
    return code === undefined ? null : t(`adminCommunityEvents.speakers.card.errors.${code}`);
  };
  const id = (suffix: string): string => `${idPrefix}-${suffix}`;
  const pickerValue = (hexColorOrNull(value.color) ?? PICKER_FALLBACK).toLowerCase();

  return (
    <div className="space-y-3">
      <EventImageDropzone
        label={t("adminCommunityEvents.speakers.card.photo")}
        hint={t("adminCommunityEvents.speakers.card.photoHint")}
        recommendation={t("adminCommunityEvents.speakers.card.photoRecommendation")}
        value={value.photoUrl}
        onValueChange={(next) => set("photoUrl", next)}
        subfolder="event-speakers"
        aspectClassName="aspect-square max-w-40"
      />
      <FieldError id={id("photo-error")} message={message("photoUrl")} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={id("label-pl")} className="text-[11px] text-muted-foreground">
            {t("adminCommunityEvents.speakers.card.ctaLabelPl")}
          </Label>
          <Input
            id={id("label-pl")}
            value={value.labelPl}
            maxLength={SPEAKER_CARD_LABEL_MAX}
            aria-invalid={errors.labelPl !== undefined}
            onChange={(event) => set("labelPl", event.target.value)}
          />
          <FieldError id={id("label-pl-error")} message={message("labelPl")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("label-en")} className="text-[11px] text-muted-foreground">
            {t("adminCommunityEvents.speakers.card.ctaLabelEn")}
          </Label>
          <Input
            id={id("label-en")}
            value={value.labelEn}
            maxLength={SPEAKER_CARD_LABEL_MAX}
            aria-invalid={errors.labelEn !== undefined}
            onChange={(event) => set("labelEn", event.target.value)}
          />
          <FieldError id={id("label-en-error")} message={message("labelEn")} />
        </div>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t("adminCommunityEvents.speakers.card.ctaLabelHint")}
      </p>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={id("url")} className="text-[11px] text-muted-foreground">
            {t("adminCommunityEvents.speakers.card.ctaUrl")}
          </Label>
          <Input
            id={id("url")}
            value={value.url}
            inputMode="url"
            placeholder={t("adminCommunityEvents.speakers.card.ctaUrlPlaceholder")}
            aria-invalid={errors.url !== undefined}
            aria-describedby={id("url-hint")}
            onChange={(event) => set("url", event.target.value)}
          />
          <p id={id("url-hint")} className="text-[11px] leading-snug text-muted-foreground">
            {t("adminCommunityEvents.speakers.card.ctaUrlHint")}
          </p>
          <FieldError id={id("url-error")} message={message("url")} />
        </div>

        <div className="grid content-start gap-1.5">
          <Label htmlFor={id("color")} className="text-[11px] text-muted-foreground">
            {t("adminCommunityEvents.speakers.card.ctaColor")}
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={pickerValue}
              aria-label={t("adminCommunityEvents.speakers.card.ctaColorPicker")}
              onChange={(event) => set("color", event.target.value)}
              className="h-9 w-10 shrink-0 cursor-pointer rounded-[6px] border border-input bg-background p-1"
            />
            <Input
              id={id("color")}
              value={value.color}
              maxLength={7}
              placeholder={PICKER_FALLBACK}
              aria-invalid={errors.color !== undefined}
              onChange={(event) => set("color", event.target.value)}
              className="font-mono"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-fit gap-1.5 px-2 text-xs"
            disabled={value.color.trim() === ""}
            onClick={() => set("color", "")}
          >
            <Palette className="h-3.5 w-3.5" aria-hidden="true" />
            {t("adminCommunityEvents.speakers.card.ctaColorReset")}
          </Button>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("adminCommunityEvents.speakers.card.ctaColorHint")}
          </p>
          <FieldError id={id("color-error")} message={message("color")} />
        </div>
      </div>
    </div>
  );
}
