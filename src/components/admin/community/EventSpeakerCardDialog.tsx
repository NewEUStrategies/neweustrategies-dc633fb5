// Dialog „Karta" przy wpisie na liscie prelegentow wydarzenia.
//
// PO CO OSOBNY DIALOG. Profil sceniczny (`SpeakerProfileAdminDialog`) stoi na
// RPC po `user_id`, wiec osoby BEZ konta - w danych referencyjnych 21 z 21 -
// nie obsluguje wcale. Karta jest zapisywana po `speaker_profile_id`
// (`admin_event_speaker_card_save`), wiec ten dialog dziala dla KAZDEGO wpisu:
// konta i kartoteki.
//
// PODGLAD TO PRAWDZIWA KARTA. Obok pol stoi `SpeakerProfileCard` - ten sam
// komponent, ktory rysuje strona prelegentow - karmiony wierszem z listy
// i szkicem pol. Klik w zdjecie w podgladzie rozwija karte tak, jak zrobi to
// uczestnik; zadna druga kopia ukladu nie moze sie tu rozjechac ze strona.
//
// SCIEZKI SA TYLKO DO ODCZYTU. Wynikaja z obsady sesji (`tracks` wpisu), wiec
// zamiast pola wyboru stoi wyjasnienie, skad sie biora.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SpeakerProfileCard } from "@/components/events/public/molecules/SpeakerProfileCard";
import { SpeakerTrackChips } from "@/components/events/SpeakerTrackChips";
import { EventSpeakerCardFields } from "./EventSpeakerCardFields";
import { uiLang } from "@/lib/i18n/format";
import { saveEventSpeakerCard, type EventSpeakerEntry } from "@/lib/admin/community";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import {
  EMPTY_SPEAKER_CARD_DRAFT,
  speakerCardDraftErrors,
  speakerCardDraftFrom,
  type SpeakerCardDraft,
} from "@/lib/events/speakerCard";
import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

ensureCommunityEventsI18n();

/** Wiersz karty publicznej ze wpisu panelu i szkicu - wejscie podgladu. */
function previewRowFromEntry(entry: EventSpeakerEntry, draft: SpeakerCardDraft): PublicSpeakerRow {
  const text = (value: string): string | null => (value.trim() === "" ? null : value.trim());
  return {
    speaker_profile_id: entry.speaker_profile_id,
    user_id: entry.user_id ?? "",
    person_id: entry.person_id,
    slug: null,
    display_name: entry.display_name,
    avatar_url: entry.avatar_url,
    job_title: entry.job_title,
    company: entry.company,
    headline_pl: entry.headline_pl ?? null,
    headline_en: entry.headline_en ?? null,
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: entry.sort_order,
    card_photo_url: text(draft.photoUrl),
    card_cta_label_pl: text(draft.labelPl),
    card_cta_label_en: text(draft.labelEn),
    card_cta_url: text(draft.url),
    card_cta_color: text(draft.color),
    tracks: entry.tracks ?? [],
  };
}

export function EventSpeakerCardDialog({
  eventId,
  speaker,
  open,
  onOpenChange,
}: {
  eventId: string;
  speaker: EventSpeakerEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<SpeakerCardDraft>(EMPTY_SPEAKER_CARD_DRAFT);
  const [error, setError] = useState<string | null>(null);
  // Karta ma DWIE wersje jezykowe (napis przycisku PL/EN, nazwy sciezek),
  // wiec podglad pozwala obejrzec obie - startuje w jezyku panelu.
  const [previewLang, setPreviewLang] = useState<"pl" | "en">(lang);

  // Zasiew przy otwarciu i przy zmianie OSOBY - nie przy kazdym odswiezeniu
  // listy w tle, ktore nadpisaloby to, co redaktor wlasnie wpisuje.
  const speakerKey = speaker?.speaker_profile_id ?? null;
  useEffect(() => {
    if (!open || speaker === null) return;
    setDraft(speakerCardDraftFrom(speaker));
    setError(null);
    setPreviewLang(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, speakerKey]);

  const hasErrors = Object.keys(speakerCardDraftErrors(draft)).length > 0;
  const previewRow = useMemo(
    () => (speaker === null ? null : previewRowFromEntry(speaker, draft)),
    [speaker, draft],
  );

  const contentRef = useRef<HTMLDivElement | null>(null);

  const saveM = useMutation({
    mutationFn: () => {
      if (speaker === null) return Promise.resolve();
      return saveEventSpeakerCard({
        speakerProfileId: speaker.speaker_profile_id,
        cardPhotoUrl: draft.photoUrl,
        cardCtaLabelPl: draft.labelPl,
        cardCtaLabelEn: draft.labelEn,
        cardCtaUrl: draft.url,
        cardCtaColor: draft.color,
      });
    },
    onSuccess: async () => {
      // Lista panelu i podglad studia czytaja karte z rejestru - oba klucze.
      await qc.invalidateQueries({ queryKey: ["admin-event-speakers", eventId] });
      await qc.invalidateQueries({ queryKey: ["admin", "event", eventId, "speakers"] });
      toast.success(t("adminCommunityEvents.speakers.card.saved"));
      onOpenChange(false);
    },
    // Komunikat bazy na ekran: CHECK-i sa nazwane, wiec redaktor wie, ktore
    // pole poprawic.
    onError: (e) => setError((e as Error).message),
  });

  if (speaker === null) return null;
  // Ten sam zapas, co etykieta wiersza na liscie: bez nazwiska tytul mowi,
  // KTORY wpis jest edytowany, zamiast konczyc sie dwukropkiem.
  const name = speaker.display_name || speaker.speaker_profile_id;
  const tracks = speaker.tracks ?? [];

  return (
    <Dialog
      open={open}
      // TRWAJACY ZAPIS TRZYMA DIALOG. Zamkniety w trakcie dialog nie pokazalby
      // odmowy bazy (komunikat ladowalby w odmontowanym stanie), a wspolna
      // mutacja zamknelaby po sukcesie dialog INNEGO prelegenta.
      onOpenChange={(next) => {
        if (!next && saveM.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        ref={contentRef}
        className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-[6px] p-5"
        // ESCAPE PRZY ROZWINIETEJ KARCIE PODGLADU zwija karte, a NIE zamyka
        // dialogu. Radix nasluchuje klawiatury w fazie przechwytywania, wiec
        // `stopPropagation` karty go nie zatrzyma - a zamkniecie dialogu
        // przepadloby niezapisane zmiany karty. Karta jest szukana w CALYM
        // dialogu, nie po celu zdarzenia: Safari i Firefox na macOS nie daja
        // fokusu przyciskowi po kliknieciu, wiec cel to wtedy sam dialog.
        onEscapeKeyDown={(event) => {
          const card = contentRef.current?.querySelector('article[data-state="expanded"]');
          if (!card) return;
          event.preventDefault();
          // Fokus w karcie: zwija ja jej wlasna obsluga klawisza. Poza karta -
          // ten sam przycisk zdjecia, co klikniecie.
          const target = event.target;
          if (!(target instanceof Node && card.contains(target))) {
            card.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.click();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("adminCommunityEvents.speakers.card.title", { name })}</DialogTitle>
          <DialogDescription>{t("adminCommunityEvents.speakers.card.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <EventSpeakerCardFields
              idPrefix={`speaker-card-${speaker.speaker_profile_id}`}
              value={draft}
              onChange={setDraft}
            />

            <section className="space-y-1.5 rounded-[6px] border border-border/60 bg-muted/20 p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("adminCommunityEvents.speakers.card.tracks")}
              </h3>
              {tracks.length > 0 ? (
                <SpeakerTrackChips
                  tracks={tracks}
                  lang={lang}
                  label={t("adminCommunityEvents.speakers.card.tracks")}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("adminCommunityEvents.speakers.card.tracksEmpty")}
                </p>
              )}
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t("adminCommunityEvents.speakers.card.tracksHint")}
              </p>
            </section>
          </div>

          <aside className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("adminCommunityEvents.speakers.card.preview")}
              </h3>
              <div
                role="group"
                aria-label={t("adminCommunityEvents.speakers.card.previewLang")}
                className="inline-flex rounded-[6px] border border-border p-0.5"
              >
                {(["pl", "en"] as const).map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    variant={previewLang === code ? "secondary" : "ghost"}
                    aria-pressed={previewLang === code}
                    className="h-6 rounded-[6px] px-2 text-[11px]"
                    onClick={() => setPreviewLang(code)}
                  >
                    {t(
                      code === "pl"
                        ? "adminCommunityEvents.speakers.card.previewLangPl"
                        : "adminCommunityEvents.speakers.card.previewLangEn",
                    )}
                  </Button>
                ))}
              </div>
            </div>
            {previewRow !== null && (
              // Znacznik podgladu builderu: `AppLink` nie nawiguje w jego
              // wnetrzu. Klik w przycisk karty wyprowadzilby z panelu i
              // przepadlby niezapisany szkic.
              <div
                data-builder-renderer="widget-props-preview"
                className="border-l border-t border-border"
              >
                <SpeakerProfileCard
                  key={speaker.speaker_profile_id}
                  speaker={previewRow}
                  lang={previewLang}
                  onSelect={speaker.user_id === null ? undefined : () => undefined}
                />
              </div>
            )}
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("adminCommunityEvents.speakers.card.previewHint")}
            </p>
          </aside>
        </div>

        {error !== null && (
          <p role="alert" className="rounded-[6px] bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveM.isPending}>
            {t("adminCommunityEvents.common.cancel")}
          </Button>
          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending || hasErrors}>
            {saveM.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            )}
            {t("adminCommunityEvents.speakers.card.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
