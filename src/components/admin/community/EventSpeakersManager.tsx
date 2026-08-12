// Panel prelegentow wydarzenia w /admin/community/events (dialog edycji):
// lista event_speakers (kolejnosc, usuwanie), dodawanie przez MemberPicker
// oraz edycja PROFILU PRELEGENTA (speaker_profiles) z mostem do CRM - zapis
// przez RPC admin_upsert_speaker_profile tworzy/aktualizuje lead (tag
// 'speaker', source_type 'speaker') i podpina crm_lead_id.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, ContactRound, Trash2 } from "lucide-react";
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

  const speakersQ = useQuery({
    queryKey: ["admin-event-speakers", eventId] as const,
    queryFn: () => fetchEventSpeakers(eventId),
    staleTime: 15_000,
  });
  const speakers = speakersQ.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-event-speakers", eventId] });

  const addM = useMutation({
    mutationFn: (userId: string) =>
      addEventSpeaker(
        eventId,
        userId,
        speakers.length ? Math.max(...speakers.map((s) => s.sort_order)) + 1 : 0,
      ),
    onSuccess: () => {
      invalidate();
      setPickerValue("");
    },
    onError: () => toast.error(t("adminCommunityEvents.speakers.toasts.addFailed")),
  });

  const removeM = useMutation({
    mutationFn: (userId: string) => removeEventSpeaker(eventId, userId),
    onSuccess: invalidate,
    onError: () => toast.error(t("adminCommunityEvents.speakers.toasts.removeFailed")),
  });

  const moveM = useMutation({
    mutationFn: async ({ index, dir }: { index: number; dir: -1 | 1 }) => {
      const target = index + dir;
      if (target < 0 || target >= speakers.length) return;
      // Przenumerowanie CALEJ listy po zamianie (sort_order = indeks), a nie
      // zamiana dwoch wartosci: rzedy legacy z rownym sort_order (default 0)
      // robilyby z zamiany no-op, a czesciowy zapis zostawialby duplikaty.
      // Przenumerowanie jest idempotentne i samonaprawia takie stany.
      const next = speakers.slice();
      [next[index], next[target]] = [next[target], next[index]];
      for (let i = 0; i < next.length; i += 1) {
        if (next[i].sort_order !== i) await setEventSpeakerOrder(eventId, next[i].user_id, i);
      }
    },
    onSuccess: invalidate,
    onError: () => toast.error(t("adminCommunityEvents.speakers.toasts.reorderFailed")),
  });

  return (
    <div className="space-y-2">
      <Label>{t("adminCommunityEvents.speakers.label")}</Label>
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
      {speakers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("adminCommunityEvents.speakers.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {speakers.map((speaker, i) => (
            <li
              key={speaker.user_id}
              className="flex items-center gap-2 rounded-[6px] border border-border/60 bg-muted/20 p-1.5"
            >
              <ChatAvatar
                name={speaker.display_name ?? ""}
                avatarUrl={speaker.avatar_url}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {speaker.display_name || speaker.user_id}
              </span>
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
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setProfileOf(speaker)}
              >
                <ContactRound className="mr-1 h-3.5 w-3.5" />
                {t("adminCommunityEvents.speakers.openProfile")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                title={t("adminCommunityEvents.speakers.removeFromEvent")}
                onClick={() => removeM.mutate(speaker.user_id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {profileOf && (
        <SpeakerProfileAdminDialog speaker={profileOf} onClose={() => setProfileOf(null)} />
      )}
    </div>
  );
}

function SpeakerProfileAdminDialog({
  speaker,
  onClose,
}: {
  speaker: EventSpeakerEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const profileQ = useQuery({
    queryKey: ["admin-speaker-profile", speaker.user_id] as const,
    queryFn: () => fetchAdminSpeakerProfile(speaker.user_id),
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
        userId: speaker.user_id,
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
      qc.invalidateQueries({ queryKey: ["admin-speaker-profile", speaker.user_id] });
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
    mutationFn: () => deleteAdminSpeakerProfile(speaker.user_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-speaker-profile", speaker.user_id] });
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
              name: speaker.display_name || speaker.user_id,
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
