// Edytor odcinka podcastu - WYCIĄG z `routes/admin.podcasts.tsx`.
//
// CO TU MIESZKA: dwukolumnowy formularz odcinka (pola dwujęzyczne, audio,
// okładka, metadane Apple, cztery warstwy: obsada, rozdziały, cytaty, źródła)
// z podglądem na żywo po prawej. Warstwa danych stoi w `lib/podcast/queries.ts`
// i `lib/podcast/shape.ts`; tutaj zostaje wyłącznie stan formularza.
//
// „ZAPISZ" WYSYŁA CAŁY ZESTAW WARSTW. Stan czterech list jest tutaj, a nie
// w kartach warstw, bo zapis odcinka to jedna transakcja panelu: wiersz
// `podcasts` plus podmiana całej obsady. Rozsypanie tego stanu po kartach
// dałoby zapis z warstwami z różnych momentów edycji.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Clock, Eye, Mic, Save } from "@/lib/lucide-shim";
import { Loader2, Upload } from "lucide-react";
import { FieldLabel } from "@/components/profile/FieldLabel";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { PodcastPlayer } from "@/components/atoms/PodcastPlayer";
import { PodcastStatusBadge } from "@/components/admin/podcasts/PodcastStatusBadge";
import {
  ChaptersEditor,
  PeopleEditor,
  QuotesEditor,
  ResourcesEditor,
} from "@/components/admin/podcasts/EpisodeLayerEditors";
import { sanitizeHtml } from "@/lib/sanitize";
import type {
  Podcast,
  PodcastChapter,
  PodcastQuote,
  PodcastResource,
  PodcastShow,
  PodcastStatus,
} from "@/lib/podcast/types";
import {
  formatDuration,
  parseChapters,
  parseDuration,
  parseQuotes,
  parseResources,
} from "@/lib/podcast/types";
import {
  episodeSeasonLabel,
  showListTitle,
  type EpisodeBundle,
  type PersonDraft,
} from "@/lib/podcast/shape";
import {
  useAdminEpisodePeople,
  useAdminPodcastCategories,
  useAdminPodcastProfiles,
} from "@/lib/podcast/queries";
import { ensureI18n as ensureAdminPodcastsI18n } from "@/lib/i18n-admin-podcasts";

/** Auto-detect an audio file's duration by loading its metadata in the browser. */
function detectAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !url) return resolve(null);
    const audio = new Audio();
    const done = (v: number | null) => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("error", onErr);
      resolve(v);
    };
    const onMeta = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    const onErr = () => done(null);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("error", onErr);
    audio.preload = "metadata";
    audio.src = url;
  });
}

export function EpisodeEditorPane({
  p,
  shows,
  onSave,
  onCancel,
  saving,
}: {
  p: Podcast;
  shows: PodcastShow[];
  onSave: (bundle: EpisodeBundle) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const [d, setD] = useState<Podcast>(p);
  const [durStr, setDurStr] = useState(formatDuration(p.duration_seconds));
  const [previewLang, setPreviewLang] = useState<"pl" | "en">("pl");
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [detectingDuration, setDetectingDuration] = useState(false);
  const [chapters, setChapters] = useState<PodcastChapter[]>(() => parseChapters(p.chapters));
  const [quotes, setQuotes] = useState<PodcastQuote[]>(() => parseQuotes(p.quotes));
  const [resources, setResources] = useState<PodcastResource[]>(() => parseResources(p.resources));
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const upd = (patch: Partial<Podcast>) => setD((prev) => ({ ...prev, ...patch }));

  // Kategorie (specjalizacje) i profile do wyboru prowadzących/gości.
  const { data: categories } = useAdminPodcastCategories();
  const { data: profiles } = useAdminPodcastProfiles();
  // Uczestnicy istniejącego odcinka: wczytujemy raz i inicjalizujemy stan.
  // `setPeople` zostaje W `queryFn` (patrz `useAdminEpisodePeople`) - przejście
  // na `useEffect` dałoby jeden render z pustą obsadą, a „Zapisz" w tym
  // renderze wymazuje uczestników odcinka.
  useAdminEpisodePeople(p.id, setPeople);

  // Wybór/wgranie pliku audio: ustaw URL i automatycznie wykryj czas trwania.
  const onAudioPicked = async (url: string) => {
    upd({ audio_url: url });
    setDetectingDuration(true);
    const secs = await detectAudioDuration(url);
    setDetectingDuration(false);
    if (secs != null && secs > 0) {
      upd({ duration_seconds: secs });
      setDurStr(formatDuration(secs));
      toast.success(t("adminPodcasts.editor.durationDetected", { time: formatDuration(secs) }));
    }
  };

  const previewTitle = previewLang === "pl" ? d.title_pl : d.title_en;
  const previewExcerpt = previewLang === "pl" ? d.excerpt_pl : d.excerpt_en;
  const previewNotes = sanitizeHtml(
    (previewLang === "pl" ? d.show_notes_pl : d.show_notes_en) ?? "",
  );
  const episodeLabel = episodeSeasonLabel(d);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
        <section className="bg-card border border-border rounded-lg p-5 space-y-5 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg">
              {d.id ? t("adminPodcasts.editor.editTitle") : t("adminPodcasts.editor.newTitle")}
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onCancel}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => onSave({ episode: d, chapters, quotes, resources, people })}
                disabled={saving}
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? "…" : t("common.save")}
              </Button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Slug</Label>
              <Input
                value={d.slug}
                onChange={(e) => upd({ slug: e.target.value })}
                placeholder={t("adminPodcasts.editor.slugPlaceholder")}
              />
            </div>
            <div>
              <Label>Status</Label>
              <select
                className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                value={d.status}
                onChange={(e) => upd({ status: e.target.value as PodcastStatus })}
              >
                <option value="draft">{t("adminPodcasts.editor.statusDraft")}</option>
                <option value="published">{t("adminPodcasts.editor.statusPublished")}</option>
                <option value="archived">{t("adminPodcasts.editor.statusArchived")}</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel tip={t("adminPodcasts.editor.showTip")}>
                {t("adminPodcasts.editor.showLabel")}
              </FieldLabel>
              <select
                className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                value={d.show_id ?? ""}
                onChange={(e) => upd({ show_id: e.target.value || null })}
              >
                <option value="">{t("adminPodcasts.editor.noShow")}</option>
                {shows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {showListTitle(s)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel tip={t("adminPodcasts.editor.categoryTip")}>
                {t("adminPodcasts.editor.categoryLabel")}
              </FieldLabel>
              <select
                className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                value={d.category_id ?? ""}
                onChange={(e) => upd({ category_id: e.target.value || null })}
              >
                <option value="">{t("adminPodcasts.editor.noCategory")}</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_pl || c.name_en}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Tabs defaultValue="pl">
            <TabsList>
              <TabsTrigger value="pl">🇵🇱 {t("adminPodcasts.tabPolish")}</TabsTrigger>
              <TabsTrigger value="en">🇬🇧 {t("adminPodcasts.tabEnglish")}</TabsTrigger>
            </TabsList>
            <TabsContent value="pl" className="space-y-3 mt-4">
              <div>
                <Label>{t("adminPodcasts.editor.fieldTitle")}</Label>
                <Input value={d.title_pl} onChange={(e) => upd({ title_pl: e.target.value })} />
              </div>
              <div>
                <Label>{t("adminPodcasts.editor.excerpt")}</Label>
                <Textarea
                  rows={2}
                  value={d.excerpt_pl}
                  onChange={(e) => upd({ excerpt_pl: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("adminPodcasts.editor.showNotes")}</Label>
                <Textarea
                  rows={5}
                  value={d.show_notes_pl}
                  onChange={(e) => upd({ show_notes_pl: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("adminPodcasts.editor.transcript")}</Label>
                <Textarea
                  rows={5}
                  value={d.transcript_pl}
                  onChange={(e) => upd({ transcript_pl: e.target.value })}
                />
              </div>
            </TabsContent>
            <TabsContent value="en" className="space-y-3 mt-4">
              <div>
                <Label>Title</Label>
                <Input value={d.title_en} onChange={(e) => upd({ title_en: e.target.value })} />
              </div>
              <div>
                <Label>Excerpt</Label>
                <Textarea
                  rows={2}
                  value={d.excerpt_en}
                  onChange={(e) => upd({ excerpt_en: e.target.value })}
                />
              </div>
              <div>
                <Label>Show notes (HTML)</Label>
                <Textarea
                  rows={5}
                  value={d.show_notes_en}
                  onChange={(e) => upd({ show_notes_en: e.target.value })}
                />
              </div>
              <div>
                <Label>Transcript</Label>
                <Textarea
                  rows={5}
                  value={d.transcript_en}
                  onChange={(e) => upd({ transcript_en: e.target.value })}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="pod-audio" tip={t("adminPodcasts.editor.audioTip")}>
                {t("adminPodcasts.editor.audioLabel")}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="pod-audio"
                  value={d.audio_url}
                  onChange={(e) => upd({ audio_url: e.target.value })}
                  onBlur={(e) => {
                    // Ręcznie wklejony URL też wyzwala wykrycie czasu, jeśli brak.
                    if (e.target.value && !d.duration_seconds) void onAudioPicked(e.target.value);
                  }}
                  placeholder={t("adminPodcasts.editor.audioPlaceholder")}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAudioPickerOpen(true)}
                  title={t("adminPodcasts.editor.uploadFromLibrary")}
                >
                  <Upload className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="pod-dur" tip={t("adminPodcasts.editor.durationTip")}>
                {t("adminPodcasts.editor.durationLabel")}
              </FieldLabel>
              <div className="relative">
                <Input
                  id="pod-dur"
                  value={durStr}
                  onChange={(e) => {
                    setDurStr(e.target.value);
                    upd({ duration_seconds: parseDuration(e.target.value) });
                  }}
                  placeholder={t("adminPodcasts.editor.durationPlaceholder")}
                />
                {detectingDuration && (
                  <Loader2 className="w-4 h-4 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                )}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>{t("adminPodcasts.editor.season")}</Label>
              <Input
                type="number"
                value={d.season ?? ""}
                onChange={(e) => upd({ season: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
            <div>
              <Label>{t("adminPodcasts.editor.episodeNumber")}</Label>
              <Input
                type="number"
                value={d.episode_number ?? ""}
                onChange={(e) =>
                  upd({ episode_number: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>
            <div>
              <Label>{t("adminPodcasts.editor.cover")}</Label>
              <div className="flex gap-2">
                <Input
                  value={d.cover_image_url ?? ""}
                  onChange={(e) => upd({ cover_image_url: e.target.value || null })}
                  placeholder={t("adminPodcasts.editor.coverPlaceholder")}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCoverPickerOpen(true)}
                  title={t("adminPodcasts.editor.uploadCoverLibraryTitle")}
                >
                  <Upload className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Apple Podcasts: <itunes:episodeType> + <itunes:explicit> na odcinku. */}
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="episode-type">{t("adminPodcasts.editor.episodeType")}</Label>
              <Select
                value={d.episode_type}
                onValueChange={(v) =>
                  upd({ episode_type: v === "trailer" || v === "bonus" ? v : "full" })
                }
              >
                <SelectTrigger id="episode-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">{t("adminPodcasts.editor.episodeTypeFull")}</SelectItem>
                  <SelectItem value="trailer">
                    {t("adminPodcasts.editor.episodeTypeTrailer")}
                  </SelectItem>
                  <SelectItem value="bonus">
                    {t("adminPodcasts.editor.episodeTypeBonus")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3 sm:col-span-2 py-2">
              <span className="text-sm">{t("adminPodcasts.editor.explicit")}</span>
              <Switch
                checked={d.explicit}
                onCheckedChange={(v) => upd({ explicit: v })}
                aria-label={t("adminPodcasts.editor.explicit")}
              />
            </label>
          </div>

          <PeopleEditor people={people} setPeople={setPeople} profiles={profiles ?? []} />
          <ChaptersEditor chapters={chapters} setChapters={setChapters} />
          <QuotesEditor quotes={quotes} setQuotes={setQuotes} />
          <ResourcesEditor resources={resources} setResources={setResources} />

          <div className="rounded-md border border-border bg-muted/30 p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t("adminPodcasts.editor.publishNow")}</div>
              <div className="text-xs text-muted-foreground">
                {t("adminPodcasts.editor.publishNowDesc")}
              </div>
            </div>
            <Switch
              checked={d.status === "published"}
              onCheckedChange={(v) =>
                upd({
                  status: v ? "published" : "draft",
                  published_at: v ? (d.published_at ?? new Date().toISOString()) : d.published_at,
                })
              }
            />
          </div>
        </section>

        <aside className="xl:sticky xl:top-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Eye className="w-3.5 h-3.5" /> {t("adminPodcasts.editor.livePreview")}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPreviewLang("pl")}
                className={`px-2 py-1 text-xs rounded ${previewLang === "pl" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                PL
              </button>
              <button
                type="button"
                onClick={() => setPreviewLang("en")}
                className={`px-2 py-1 text-xs rounded ${previewLang === "en" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                EN
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-gradient-to-br from-muted/40 to-muted/10 p-4 space-y-4">
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="relative aspect-square bg-muted">
                {d.cover_image_url ? (
                  <img src={d.cover_image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Mic className="w-16 h-16 text-muted-foreground/40" />
                  </div>
                )}
                {episodeLabel && (
                  <span className="absolute top-3 left-3 px-2 py-1 rounded bg-background/90 backdrop-blur text-xs font-semibold tabular-nums">
                    {episodeLabel}
                  </span>
                )}
                <span className="absolute top-3 right-3">
                  <PodcastStatusBadge status={d.status} />
                </span>
              </div>
              <div className="p-4 space-y-2">
                <h3 className="font-display text-lg leading-tight">
                  {previewTitle ||
                    (previewLang === "pl"
                      ? t("adminPodcasts.editor.previewTitleFallback")
                      : "Episode title")}
                </h3>
                {previewExcerpt && (
                  <p className="text-sm text-muted-foreground line-clamp-3">{previewExcerpt}</p>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  <Clock className="w-3 h-3" /> {formatDuration(d.duration_seconds)}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                {t("adminPodcasts.editor.player")}
              </div>
              {d.audio_url ? (
                <PodcastPlayer
                  src={d.audio_url}
                  title={previewTitle || d.slug}
                  initialDuration={d.duration_seconds}
                  variant="full"
                  lang={previewLang}
                />
              ) : (
                <div className="text-xs text-muted-foreground py-6 text-center bg-card border border-dashed border-border rounded-md">
                  {t("adminPodcasts.editor.addAudioHint")}
                </div>
              )}
            </div>

            {previewNotes && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                  Show notes
                </div>
                <div
                  className="text-xs leading-relaxed bg-card border border-border rounded-md p-3 max-h-48 overflow-auto prose prose-sm dark:prose-invert [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: previewNotes }}
                />
              </div>
            )}
          </div>
        </aside>

        <MediaPickerDialog
          open={audioPickerOpen}
          onOpenChange={setAudioPickerOpen}
          onPick={(url) => void onAudioPicked(url)}
          accept="all"
          title={t("adminPodcasts.editor.pickAudio")}
        />
        <MediaPickerDialog
          open={coverPickerOpen}
          onOpenChange={setCoverPickerOpen}
          onPick={(url) => upd({ cover_image_url: url })}
          accept="image"
          title={t("adminPodcasts.editor.pickCover")}
        />
      </div>
    </TooltipProvider>
  );
}
