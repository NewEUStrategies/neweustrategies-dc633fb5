// Popup „Nowy prelegent" - ZAKLADA OSOBE BEZ KONTA i podpina ja do wydarzenia.
//
// PO CO ISTNIEJE. Do tej pory ekran prelegentow mial jedno pole wejsciowe:
// droplista „Dodaj prelegenta…", ktora jest wyszukiwarka ISTNIEJACYCH KONT
// platformy (`MemberPicker` -> SELECT z `profiles`). Osoby bez konta nie dalo
// sie dodac w ogole - blokowal to model danych, nie interfejs (migracja
// 20260826180000_event_speaker_person.sql zdejmuje te blokade). W danych
// referencyjnych wzorca 21 z 21 prelegentow NIE MA konta, wiec brakowalo
// ścieżki dla przypadku typowego, nie brzegowego.
//
// UKLAD JEST WZIETY ZE WZORCA, nie wymyslony: zrzut
// docs/zrzuty/swapcard-2026-08-23/06-content-people-create-manually-dialog.png
// pokazuje dialog „Create manually" z kolejnoscia Grupa / Adres poczty (z nota
// pod polem) / Imie + Nazwisko w jednym rzedzie / Stanowisko + Instytucja
// w jednym rzedzie i JEDNYM przyciskiem w prawym dolnym rogu, wylaczonym do
// wypelnienia pol wymaganych. Rozszerzenie (zdjecie, rola sceniczna, bio,
// telefon, profil zawodowy) wymusza karta na stronie publicznej: ma trzy linie
// (nazwisko / rola / instytucja) i zdjecie, wiec bez tych pol osoba bez konta
// dostaje karte z inicjalami.
//
// DWIE ROZNICE WOBEC WZORCA, obie swiadome:
//   * GRUPA JEST OPCJONALNA. We wzorcu grupa JEST rola (jedna lista osob,
//     rola wynika z grupy). U nas rola „prelegent" wynika z wpisu do rejestru
//     prelegentow, a grupa niesie uprawnienia - wiec brak grupy nie moze
//     blokowac zalozenia prelegenta.
//   * STOPKA MA „Anuluj" OBOK „Utworz". Wzorzec ma jeden przycisk, a wyjscie
//     tylko przez „x" w naglowku; przy kilkunastu polach czyta sie to jak
//     pulapka. Konwencja repozytorium (EventSessionDialog) to para
//     outline + primary.
//
// ANIMACJA IDZIE Z TEGO, CO JEST W REPOZYTORIUM. W `package.json` NIE MA ani
// `framer-motion`, ani `tailwindcss-animate` - jest `tw-animate-css`
// (importowany w `src/styles.css`). `DialogContent` animuje sie sam
// (`fade-in-0`, `zoom-in-95`, `duration-200`), a sekcje formularza dostaja
// wejscie kaskadowe przez istniejaca klase `.pc-rise-y` ze `styles.css`, ktora
// jest tam opisana wprost jako „odpowiednik framer-motion bez biblioteki"
// i wygasa przy `prefers-reduced-motion: reduce`. Zadnej nowej zaleznosci.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Info, Loader2, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { uiLang } from "@/lib/i18n/format";
import { useAuth } from "@/hooks/useAuth";
import { registerMediaUpload } from "@/lib/media.functions";
import { IMAGE_ACCEPT_ATTR, IMAGE_MIME, uploadAndRegisterMedia } from "@/lib/media/upload";
import { useEventGroups } from "@/lib/events/useEventTermsGroups";
import { createEventSpeakerPerson, type EventSpeakerUpsertResult } from "@/lib/admin/community";


/** „Bez grupy" nie moze byc pustym napisem: Radix Select rezerwuje "" na reset. */
const NO_GROUP = "__none__";

interface Draft {
  groupId: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  photoUrl: string;
  headlinePl: string;
  headlineEn: string;
  bioPl: string;
  bioEn: string;
  topicsPl: string;
  topicsEn: string;
  languages: string;
  phone: string;
  socialUrl: string;
  isPublic: boolean;
}

const EMPTY_DRAFT: Draft = {
  groupId: NO_GROUP,
  email: "",
  firstName: "",
  lastName: "",
  jobTitle: "",
  company: "",
  photoUrl: "",
  headlinePl: "",
  headlineEn: "",
  bioPl: "",
  bioEn: "",
  topicsPl: "",
  topicsEn: "",
  languages: "",
  phone: "",
  socialUrl: "",
  isPublic: true,
};

/** Pusty napis idzie do RPC jako `undefined`, czyli „nie dotykaj kolumny". */
const trimmedOrUndefined = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/**
 * Lista po przecinku -> tablica. Ten sam idiom, co w istniejacym dialogu
 * profilu prelegenta (`csvToList` w EventSpeakersManager): dwa rozne sposoby
 * wpisywania tematow w dwoch dialogach tej samej osoby to pewny rozjazd.
 * Puste pole oddaje `undefined`, czyli „nie dotykaj kolumny" - nie `[]`,
 * ktore znaczy „wyczysc".
 */
const csvOrUndefined = (value: string): string[] | undefined => {
  const items = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return items.length === 0 ? undefined : items;
};

/**
 * WYROWNANIE ETYKIET. Pola stoja obok siebie w siatce, wiec etykieta i podpowiedz
 * dostaja STALA wysokosc wiersza (`h-4` / `min-h-3.5`) - inaczej pole z
 * podpowiedzia bylo nizsze od sasiada i ramki inputow rozjezdzaly sie o kilka
 * pikseli. Siatka `auto auto 1fr` trzyma kontrolke zawsze w tym samym wierszu.
 */
function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1 [grid-template-rows:1rem_auto_1fr]">
      <Label className="flex h-4 items-center text-[11px] font-medium leading-none text-muted-foreground">
        {required === true && (
          <span aria-hidden="true" className="mr-1 text-destructive">
            *
          </span>
        )}
        {label}
      </Label>
      {children}
      <p className="min-h-3.5 text-[10.5px] leading-snug text-muted-foreground">{hint ?? ""}</p>
    </div>
  );
}

function Section({
  title,
  delayMs,
  children,
}: {
  title: string;
  delayMs: number;
  children: ReactNode;
}) {
  return (
    <section
      className="pc-rise-y space-y-2.5 rounded-[6px] border border-border/60 bg-muted/20 p-3"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}


export function EventSpeakerCreateDialog({
  eventId,
  open,
  onOpenChange,
  onCreated,
}: {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: EventSpeakerUpsertResult, displayName: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  // Grupy czytamy TYLKO przy otwartym popupie: zamknięty dialog nie ma prawa
  // trzymać zapytania, ktore odpala sie na kazdym wejsciu w ekran prelegentow.
  const groupsQ = useEventGroups(eventId, open);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  // Wymagane sa DWA pola, nie cztery jak we wzorcu: adres poczty jest u nas
  // kluczem dopasowania, a nie loginem zakladanego konta - osoba bez adresu
  // (mowca zaproszony przez sekretariat) musi dac sie wpisac.
  const canSubmit = useMemo(
    () => draft.firstName.trim() !== "" && draft.lastName.trim() !== "",
    [draft.firstName, draft.lastName],
  );

  const createM = useMutation({
    mutationFn: () =>
      createEventSpeakerPerson({
        eventId,
        groupId: draft.groupId === NO_GROUP ? undefined : draft.groupId,
        email: trimmedOrUndefined(draft.email),
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        jobTitle: trimmedOrUndefined(draft.jobTitle),
        companyText: trimmedOrUndefined(draft.company),
        phone: trimmedOrUndefined(draft.phone),
        socialProfileUrl: trimmedOrUndefined(draft.socialUrl),
        photoUrl: trimmedOrUndefined(draft.photoUrl),
        bioPl: trimmedOrUndefined(draft.bioPl),
        bioEn: trimmedOrUndefined(draft.bioEn),
        headlinePl: trimmedOrUndefined(draft.headlinePl),
        headlineEn: trimmedOrUndefined(draft.headlineEn),
        topicsPl: csvOrUndefined(draft.topicsPl),
        topicsEn: csvOrUndefined(draft.topicsEn),
        // Kody jezykow ida MALYMI literami - tak je czyta widget publiczny
        // i tak zapisuje je istniejacy dialog profilu.
        languages: csvOrUndefined(draft.languages.toLowerCase()),
        isPublic: draft.isPublic,
      }),
    onSuccess: (result) => {
      const name = `${draft.firstName.trim()} ${draft.lastName.trim()}`.trim();
      setDraft(EMPTY_DRAFT);
      setError(null);
      onCreated(result, name);
      onOpenChange(false);
    },
    // KOMUNIKAT BAZY IDZIE NA EKRAN. Ograniczenia sa nazwane (https na zdjeciu,
    // format adresu, unikalnosc adresu w kartotece), wiec zamiana ich na jedno
    // „nie udalo sie" kosztuje redaktora zgadywanie, ktore pole poprawic.
    onError: (e) => setError((e as Error).message),
  });

  const close = (next: boolean): void => {
    if (!next) {
      setDraft(EMPTY_DRAFT);
      setError(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px]">
        <DialogHeader>
          <DialogTitle>{t("adminCommunityEvents.speakers.create.title")}</DialogTitle>
          <DialogDescription>
            {t("adminCommunityEvents.speakers.create.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Section title={t("adminCommunityEvents.speakers.create.sectionPerson")} delayMs={0}>
            <Field
              label={t("adminCommunityEvents.speakers.create.group")}
              hint={t("adminCommunityEvents.speakers.create.groupHint")}
            >
              <Select value={draft.groupId} onValueChange={(value) => set("groupId", value)}>
                <SelectTrigger aria-label={t("adminCommunityEvents.speakers.create.group")}>
                  <SelectValue
                    placeholder={t("adminCommunityEvents.speakers.create.groupPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>
                    {t("adminCommunityEvents.speakers.create.groupPlaceholder")}
                  </SelectItem>
                  {groupsQ.isLoading ? (
                    <SelectItem value="__loading__" disabled>
                      {t("adminCommunityEvents.speakers.create.groupLoading")}
                    </SelectItem>
                  ) : (
                    (groupsQ.data ?? []).map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {lang === "en"
                          ? group.name_en || group.name_pl
                          : group.name_pl || group.name_en}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={t("adminCommunityEvents.speakers.create.email")}
              hint={t("adminCommunityEvents.speakers.create.emailHint")}
            >
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder={t("adminCommunityEvents.speakers.create.emailPlaceholder")}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("adminCommunityEvents.speakers.create.firstName")} required>
                <Input
                  autoFocus
                  value={draft.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                  placeholder={t("adminCommunityEvents.speakers.create.firstNamePlaceholder")}
                />
              </Field>
              <Field label={t("adminCommunityEvents.speakers.create.lastName")} required>
                <Input
                  value={draft.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                  placeholder={t("adminCommunityEvents.speakers.create.lastNamePlaceholder")}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("adminCommunityEvents.speakers.create.jobTitle")}>
                <Input
                  value={draft.jobTitle}
                  onChange={(e) => set("jobTitle", e.target.value)}
                  placeholder={t("adminCommunityEvents.speakers.create.jobTitlePlaceholder")}
                />
              </Field>
              <Field label={t("adminCommunityEvents.speakers.create.company")}>
                <Input
                  value={draft.company}
                  onChange={(e) => set("company", e.target.value)}
                  placeholder={t("adminCommunityEvents.speakers.create.companyPlaceholder")}
                />
              </Field>
            </div>
          </Section>

          <Section title={t("adminCommunityEvents.speakers.create.sectionCard")} delayMs={60}>
            <Field
              label={t("adminCommunityEvents.speakers.create.photoUrl")}
              hint={t("adminCommunityEvents.speakers.create.photoUrlHint")}
            >
              <Input
                value={draft.photoUrl}
                onChange={(e) => set("photoUrl", e.target.value)}
                placeholder={t("adminCommunityEvents.speakers.create.photoUrlPlaceholder")}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t("adminCommunityEvents.speakers.create.headlinePl")}
                hint={t("adminCommunityEvents.speakers.create.headlineHint")}
              >
                <Input
                  value={draft.headlinePl}
                  onChange={(e) => set("headlinePl", e.target.value)}
                />
              </Field>
              <Field label={t("adminCommunityEvents.speakers.create.headlineEn")}>
                <Input
                  value={draft.headlineEn}
                  onChange={(e) => set("headlineEn", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("adminCommunityEvents.speakers.create.bioPl")}>
                <Textarea
                  rows={3}
                  value={draft.bioPl}
                  onChange={(e) => set("bioPl", e.target.value)}
                />
              </Field>
              <Field label={t("adminCommunityEvents.speakers.create.bioEn")}>
                <Textarea
                  rows={3}
                  value={draft.bioEn}
                  onChange={(e) => set("bioEn", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label={t("adminCommunityEvents.speakers.create.topicsPl")}
                hint={t("adminCommunityEvents.speakers.create.topicsHint")}
              >
                <Input value={draft.topicsPl} onChange={(e) => set("topicsPl", e.target.value)} />
              </Field>
              <Field label={t("adminCommunityEvents.speakers.create.topicsEn")}>
                <Input value={draft.topicsEn} onChange={(e) => set("topicsEn", e.target.value)} />
              </Field>
              <Field label={t("adminCommunityEvents.speakers.create.languages")}>
                <Input
                  value={draft.languages}
                  onChange={(e) => set("languages", e.target.value)}
                  placeholder={t("adminCommunityEvents.speakers.create.languagesPlaceholder")}
                />
              </Field>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Switch
                checked={draft.isPublic}
                onCheckedChange={(value) => set("isPublic", value)}
                aria-label={t("adminCommunityEvents.speakers.create.isPublic")}
              />
              <span className="grid gap-0.5">
                <span>{t("adminCommunityEvents.speakers.create.isPublic")}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {t("adminCommunityEvents.speakers.create.isPublicHint")}
                </span>
              </span>
            </label>
          </Section>

          <Section title={t("adminCommunityEvents.speakers.create.sectionContact")} delayMs={120}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("adminCommunityEvents.speakers.create.phone")}>
                <Input
                  value={draft.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder={t("adminCommunityEvents.speakers.create.phonePlaceholder")}
                />
              </Field>
              <Field label={t("adminCommunityEvents.speakers.create.socialUrl")}>
                <Input
                  value={draft.socialUrl}
                  onChange={(e) => set("socialUrl", e.target.value)}
                  placeholder={t("adminCommunityEvents.speakers.create.socialUrlPlaceholder")}
                />
              </Field>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("adminCommunityEvents.speakers.create.contactHint")}
            </p>
          </Section>

          {/* Nota RODO stoi przy polach, ktorych dotyczy - wzorzec trzyma taka
              sama note na ekranie pol osobowych (zrzut 05). */}
          <p className="flex gap-2 rounded-[6px] border border-border/60 bg-background p-3 text-[11px] leading-snug text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("adminCommunityEvents.speakers.create.consentNote")}
          </p>

          {error !== null && (
            <p
              role="alert"
              className="rounded-[6px] bg-destructive/10 p-3 text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto self-center text-[11px] text-muted-foreground">
            {t("adminCommunityEvents.speakers.create.requiredHint")}
          </span>
          <Button variant="outline" onClick={() => close(false)} disabled={createM.isPending}>
            {t("adminCommunityEvents.common.cancel")}
          </Button>
          <Button onClick={() => createM.mutate()} disabled={!canSubmit || createM.isPending}>
            {createM.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {createM.isPending
              ? t("adminCommunityEvents.speakers.create.submitting")
              : t("adminCommunityEvents.speakers.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
