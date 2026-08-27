// Panel prelegentow wydarzenia: lista, kolejnosc, usuwanie, dwie sciezki
// dodania oraz edycja PROFILU PRELEGENTA (speaker_profiles) z mostem do CRM.
//
// CO SIE ZMIENILO I DLACZEGO. Panel mial JEDNO pole wejsciowe - droplista
// „Dodaj prelegenta…", ktora jest wyszukiwarka ISTNIEJACYCH KONT platformy
// (`MemberPicker` -> SELECT z `profiles` + ilike, zero RPC). Rejestr, do
// ktorego pisala, nie dopuszczal osoby bez konta (`event_speakers.user_id NOT
// NULL REFERENCES auth.users`, PK `(event_id, user_id)`), wiec „zalozenie
// prelegenta ze szczegolami" bylo niedostepne Z DEFINICJI, a nie zepsute.
// Migracja 20260826180000 dodaje druga sciezke, a ten ekran ja pokazuje:
// przycisk „Nowy prelegent" NAD droplista, bo to przypadek TYPOWY - w danych
// referencyjnych wzorca 21 z 21 prelegentow nie ma konta.
//
// TRZY STANY LISTY, NIE JEDEN. Wczesniej blad odczytu wygladal jak puste
// wydarzenie („Brak prelegentow"), czyli odmowa RLS byla nie do odroznienia od
// prawdy. Teraz blad ma wlasny komunikat z tresci wyjatku i przycisk ponowienia.
//
// PLAKIETKA O SZKICU. Publiczna projekcja filtruje po `status = 'published'`
// (`event_speakers_public`, wczesniej `get_public_speakers`), wiec na szkicu
// lista prelegentow NIE JEST widoczna publicznie. Bez tego zdania redaktor
// dodaje pieciu prelegentow, patrzy na strone i uznaje, ze funkcja nie dziala.
// Status czytamy z TEGO SAMEGO klucza cache, co rama studia - to nie jest
// drugie zapytanie o to samo wydarzenie.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ContactRound,
  EyeOff,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { MemberPicker } from "./MemberPicker";
import { EventSpeakerCreateDialog } from "./EventSpeakerCreateDialog";
import { useAdminEventDetail } from "@/lib/events/useAdminEventDetail";
import {
  addEventSpeaker,
  deleteAdminSpeakerProfile,
  fetchAdminSpeakerProfile,
  fetchEventSpeakers,
  removeEventSpeaker,
  setEventSpeakerOrder,
  upsertAdminSpeakerProfile,
  type EventSpeakerEntry,
} from "@/lib/admin/community";

const csvToList = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function EventSpeakersManager({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pickerValue, setPickerValue] = useState("");
  const [profileOf, setProfileOf] = useState<EventSpeakerEntry | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const detailQ = useAdminEventDetail(eventId);
  const isDraft =
    detailQ.data !== null && detailQ.data !== undefined
      ? detailQ.data.status !== "published"
      : false;

  const speakersQ = useQuery({
    queryKey: ["admin-event-speakers", eventId] as const,
    queryFn: () => fetchEventSpeakers(eventId),
    staleTime: 15_000,
  });
  const speakers = speakersQ.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-event-speakers", eventId] });

  const addM = useMutation({
    mutationFn: (userId: string) => addEventSpeaker(eventId, userId),
    onSuccess: () => {
      invalidate();
      setPickerValue("");
    },
    // Komunikat bazy, nie jedno „nie udalo sie": RPC odmawia NAZWANYM bledem
    // (obcy najemca, brak profilu, brak roli), a redaktor musi wiedziec ktorym.
    onError: (e) => toast.error((e as Error).message),
  });

  const removeM = useMutation({
    mutationFn: (speaker: EventSpeakerEntry) =>
      removeEventSpeaker(eventId, {
        speakerProfileId: speaker.speaker_profile_id,
        // `user_id` jedzie RAZEM z profilem: dla wiersza z konta trzeba zdjac
        // takze rzad z legacy `event_speakers`, inaczej osoba wraca po
        // odswiezeniu z drugiego rejestru.
        userId: speaker.user_id ?? undefined,
      }),
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });

  const moveM = useMutation({
    mutationFn: ({ index, dir }: { index: number; dir: -1 | 1 }) => {
      const target = index + dir;
      if (target < 0 || target >= speakers.length) return Promise.resolve(0);
      // Przenumerowanie CALEJ listy po zamianie (sort_order = indeks), a nie
      // zamiana dwoch wartosci: rzedy legacy z rownym sort_order (default 0)
      // robilyby z zamiany no-op, a czesciowy zapis zostawialby duplikaty.
      // Cala kolejnosc jedzie JEDNYM wywolaniem, wiec nie ma stanu polowicznego.
      const next = speakers.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return setEventSpeakerOrder(eventId, next);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-3">
      {isDraft && (
        <p className="flex gap-2 rounded-[6px] border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-snug text-foreground">
          <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminCommunityEvents.speakers.draftNotice")}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Label>{t("adminCommunityEvents.speakers.label")}</Label>
        <Button size="sm" className="h-8 text-xs" onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("adminCommunityEvents.speakers.newAction")}
        </Button>
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">
          {t("adminCommunityEvents.speakers.pickerLabel")}
        </span>
        <MemberPicker
          value={pickerValue}
          onChange={(userId) => {
            setPickerValue(userId);
            if (userId && !speakers.some((s) => s.user_id === userId)) {
              addM.mutate(userId);
            }
          }}
          labels={{
            placeholder: t("adminCommunityEvents.speakers.picker.placeholder"),
            search: t("adminCommunityEvents.speakers.picker.search"),
            hint: t("adminCommunityEvents.speakers.picker.hint"),
            loading: t("adminCommunityEvents.speakers.picker.loading"),
            empty: t("adminCommunityEvents.speakers.picker.empty"),
            clear: t("adminCommunityEvents.speakers.picker.clear"),
          }}
        />
      </div>

      {speakersQ.isError ? (
        // TRZECI STAN. Odmowa RLS i pusta lista wygladaly identycznie, wiec
        // „Brak prelegentow" bylo komunikatem o bledzie podanym jako fakt.
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-[6px] border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {t("adminCommunityEvents.speakers.loadFailed")} {(speakersQ.error as Error).message}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => void speakersQ.refetch()}
          >
            {t("adminCommunityEvents.speakers.retry")}
          </Button>
        </div>
      ) : speakers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("adminCommunityEvents.speakers.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {speakers.map((speaker, i) => (
            <li
              // KLUCZ TO `speaker_profile_id`, nie `user_id`: osoba bez konta ma
              // `user_id = null`, a dwa takie wiersze dostawaly ten sam klucz.
              key={speaker.speaker_profile_id}
              className="flex items-center gap-2 rounded-[6px] border border-border/60 bg-muted/20 p-1.5"
            >
              <ChatAvatar
                name={speaker.display_name ?? ""}
                avatarUrl={speaker.avatar_url}
                size="sm"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">
                  {speaker.display_name || speaker.speaker_profile_id}
                </span>
                {(speaker.job_title !== null || speaker.company !== null) && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {[speaker.job_title, speaker.company].filter(Boolean).join(", ")}
                  </span>
                )}
              </span>
              {speaker.person_id !== null && (
                <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {t("adminCommunityEvents.speakers.noAccount")}
                </span>
              )}
              {speaker.is_legacy && (
                <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {t("adminCommunityEvents.speakers.legacyBadge")}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={t("adminCommunityEvents.speakers.moveUp")}
                disabled={i === 0 || moveM.isPending}
                onClick={() => moveM.mutate({ index: i, dir: -1 })}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={t("adminCommunityEvents.speakers.moveDown")}
                disabled={i === speakers.length - 1 || moveM.isPending}
                onClick={() => moveM.mutate({ index: i, dir: 1 })}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {/* Dialog profilu scenicznego stoi na RPC po `user_id`, wiec dla
                  osoby BEZ konta nie ma czego otworzyc - jej pola redaguje
                  popup kartoteki. Przycisk jest wtedy ukryty, nie martwy. */}
              {speaker.user_id !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setProfileOf(speaker)}
                >
                  <ContactRound className="mr-1 h-3.5 w-3.5" />
                  {t("adminCommunityEvents.speakers.openProfile")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                title={t("adminCommunityEvents.speakers.removeFromEvent")}
                onClick={() => removeM.mutate(speaker)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <EventSpeakerCreateDialog
        eventId={eventId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(_result, name) => {
          invalidate();
          toast.success(t("adminCommunityEvents.speakers.toasts.created", { name }));
        }}
      />

      {profileOf && profileOf.user_id !== null && (
        <SpeakerProfileAdminDialog
          speaker={profileOf}
          userId={profileOf.user_id}
          onClose={() => setProfileOf(null)}
        />
      )}
    </div>
  );
}

/**
 * Dialog nakladki scenicznej. `userId` jest ODDZIELNYM propsem, a nie czytany
 * z `speaker.user_id`: po migracji ta kolumna jest opcjonalna (osoba bez
 * konta), a wszystkie trzy RPC profilu (`admin_*_speaker_profile`) przyjmuja
 * `p_user_id uuid` i bez niego nie maja czego szukac. Rodzic udowadnia
 * warunkiem, ze konto jest - typ nie pozwala tego pominac.
 */
function SpeakerProfileAdminDialog({
  speaker,
  userId,
  onClose,
}: {
  speaker: EventSpeakerEntry;
  userId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const profileQ = useQuery({
    queryKey: ["admin-speaker-profile", userId] as const,
    queryFn: () => fetchAdminSpeakerProfile(userId),
    staleTime: 5_000,
  });

  const [headlinePl, setHeadlinePl] = useState("");
  const [headlineEn, setHeadlineEn] = useState("");
  const [bioPl, setBioPl] = useState("");
  const [bioEn, setBioEn] = useState("");
  const [topicsPl, setTopicsPl] = useState("");
  const [topicsEn, setTopicsEn] = useState("");
  const [languages, setLanguages] = useState("");
  const [talksCount, setTalksCount] = useState("0");
  const [rating, setRating] = useState("0");
  const [reviewsCount, setReviewsCount] = useState("0");
  const [isPublic, setIsPublic] = useState(true);
  const [syncCrm, setSyncCrm] = useState(true);
  const [crmLeadId, setCrmLeadId] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Zasiew formularza po pierwszym udanym odczycie (brak wiersza = defaulty).
  useEffect(() => {
    if (seeded || profileQ.isLoading) return;
    const p = profileQ.data;
    if (p) {
      setHeadlinePl(p.headline_pl);
      setHeadlineEn(p.headline_en);
      setBioPl(p.bio_pl);
      setBioEn(p.bio_en);
      setTopicsPl(p.topics_pl.join(", "));
      setTopicsEn(p.topics_en.join(", "));
      setLanguages(p.languages.join(", "));
      setTalksCount(String(p.talks_count));
      setRating(String(p.rating));
      setReviewsCount(String(p.reviews_count));
      setIsPublic(p.is_public);
      setCrmLeadId(p.crm_lead_id);
    }
    setSeeded(true);
  }, [seeded, profileQ.isLoading, profileQ.data]);

  const saveM = useMutation({
    mutationFn: () =>
      upsertAdminSpeakerProfile({
        userId: userId,
        headlinePl,
        headlineEn,
        bioPl,
        bioEn,
        topicsPl: csvToList(topicsPl),
        topicsEn: csvToList(topicsEn),
        languages: csvToList(languages).map((l) => l.toLowerCase()),
        talksCount: Math.max(0, Number(talksCount) || 0),
        rating: Math.min(5, Math.max(0, Number(rating) || 0)),
        reviewsCount: Math.max(0, Number(reviewsCount) || 0),
        isPublic,
        syncCrm,
      }),
    onSuccess: (result) => {
      setCrmLeadId(result.crm_lead_id);
      qc.invalidateQueries({ queryKey: ["admin-speaker-profile", userId] });
      toast.success(
        t(
          result.crm_lead_id
            ? "adminCommunityEvents.speakers.profile.savedWithCrm"
            : "adminCommunityEvents.speakers.profile.saved",
        ),
      );
    },
    onError: (e) => toast.error(String((e as Error).message)),
  });

  const deleteM = useMutation({
    mutationFn: () => deleteAdminSpeakerProfile(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-speaker-profile", userId] });
      toast.success(t("adminCommunityEvents.speakers.profile.deleted"));
      onClose();
    },
    onError: (e) => toast.error(String((e as Error).message)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px]">
        <DialogHeader>
          <DialogTitle>
            {t("adminCommunityEvents.speakers.profile.title", {
              name: speaker.display_name || userId,
            })}
          </DialogTitle>
        </DialogHeader>

        {profileQ.isLoading && !seeded ? (
          <p className="text-sm text-muted-foreground">
            {t("adminCommunityEvents.speakers.profile.loading")}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.headlinePl")}</Label>
                <Input value={headlinePl} onChange={(e) => setHeadlinePl(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.headlineEn")}</Label>
                <Input value={headlineEn} onChange={(e) => setHeadlineEn(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.bioPl")}</Label>
                <Textarea rows={3} value={bioPl} onChange={(e) => setBioPl(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.bioEn")}</Label>
                <Textarea rows={3} value={bioEn} onChange={(e) => setBioEn(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.topicsPl")}</Label>
                <Input value={topicsPl} onChange={(e) => setTopicsPl(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.topicsEn")}</Label>
                <Input value={topicsEn} onChange={(e) => setTopicsEn(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.languages")}</Label>
                <Input
                  value={languages}
                  onChange={(e) => setLanguages(e.target.value)}
                  placeholder="pl, en"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.talks")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={talksCount}
                  onChange={(e) => setTalksCount(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.rating")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("adminCommunityEvents.speakers.profile.reviews")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={reviewsCount}
                  onChange={(e) => setReviewsCount(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                {t("adminCommunityEvents.speakers.profile.isPublic")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={syncCrm} onCheckedChange={setSyncCrm} />
                {t("adminCommunityEvents.speakers.profile.syncCrm")}
              </label>
            </div>
            {crmLeadId && (
              <p className="text-xs text-muted-foreground">
                {t("adminCommunityEvents.speakers.profile.crmLead")}{" "}
                <Link
                  to="/admin/crm/$id"
                  params={{ id: crmLeadId }}
                  className="text-brand-ink hover:underline"
                >
                  {crmLeadId}
                </Link>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {profileQ.data && (
            <Button
              variant="destructive"
              className="mr-auto"
              disabled={deleteM.isPending}
              onClick={() => {
                if (window.confirm(t("adminCommunityEvents.speakers.profile.deleteConfirm"))) {
                  deleteM.mutate();
                }
              }}
            >
              {t("adminCommunityEvents.speakers.profile.deleteAction")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("adminCommunityEvents.common.close")}
          </Button>
          <Button onClick={() => saveM.mutate()} disabled={saveM.isPending || profileQ.isLoading}>
            {t("adminCommunityEvents.speakers.profile.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
