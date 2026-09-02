// Panel programów (serii) podcastowych - WYCIĄG z `routes/admin.podcasts.tsx`.
//
// CO TU MIESZKA: lista programów z potwierdzeniem usunięcia i formularz
// programu (dwie zakładki językowe, kolejność redakcyjna, adresy platform).
// Cała warstwa danych stoi w `lib/podcast/queries.ts`, więc ten plik jest
// wyłącznie widokiem: pomyłka w nim widać na ekranie, a nie w bazie.
//
// USUNIĘCIE ZAWSZE PRZEZ POTWIERDZENIE. Program niesie odcinki - kliknięcie
// „Usuń" bez pytania zabierałoby z publicznej strony całą serię, a panel nie
// ma ekranu przywracania (soft-delete odwraca się tylko z bazy).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, Plus, Save, Trash2 } from "@/lib/lucide-shim";
import { Upload } from "lucide-react";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { PodcastStatusBadge } from "@/components/admin/podcasts/PodcastStatusBadge";
import { useAuth } from "@/hooks/useAuth";
import type { PodcastShow, PodcastStatus } from "@/lib/podcast/types";
import { newShowDraft, showListTitle } from "@/lib/podcast/shape";
import {
  useAdminPodcastShows,
  useSaveAdminShow,
  useSoftDeleteAdminShow,
  type PodcastAdminMessages,
} from "@/lib/podcast/queries";
import { ensureI18n as ensureAdminPodcastsI18n } from "@/lib/i18n-admin-podcasts";

export function PodcastShowsPane({ onClose }: { onClose: () => void }) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<PodcastShow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: shows } = useAdminPodcastShows();

  // Komunikaty odmowy zapisu budujemy tutaj, bo `t()` mieszka w komponencie -
  // warstwa danych ma je dostać gotowe, a nie znać i18n.
  const messages: PodcastAdminMessages = {
    slug: t("adminPodcasts.errors.slug"),
    audio: t("adminPodcasts.errors.audio"),
    tenant: t("adminPodcasts.errors.tenant"),
  };
  const save = useSaveAdminShow({ tenantId, messages, onSaved: () => setEditing(null) });
  const remove = useSoftDeleteAdminShow();

  if (editing) {
    return (
      <ShowEditor
        s={editing}
        onCancel={() => setEditing(null)}
        onSave={(s) => save.mutate(s)}
        saving={save.isPending}
      />
    );
  }

  return (
    <section className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg">{t("adminPodcasts.shows.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("adminPodcasts.shows.desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditing(newShowDraft(shows?.length ?? 0))}>
            <Plus className="w-4 h-4 mr-2" />
            {t("adminPodcasts.shows.newShow")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("adminPodcasts.shows.back")}
          </Button>
        </div>
      </div>

      {(shows ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          {t("adminPodcasts.shows.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {(shows ?? []).map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
            >
              {s.cover_image_url ? (
                <img
                  src={s.cover_image_url}
                  alt=""
                  className="w-12 h-12 rounded-md object-cover border border-border"
                />
              ) : (
                <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                  <Mic className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <button
                  className="font-medium hover:underline text-left"
                  onClick={() => setEditing(s)}
                >
                  {showListTitle(s)}
                </button>
                <div className="text-xs text-muted-foreground font-mono">{s.slug}</div>
              </div>
              <PodcastStatusBadge status={s.status} />
              <button
                onClick={() => setConfirmId(s.id)}
                className="text-xs text-destructive hover:underline inline-flex items-center gap-1 ml-2"
              >
                <Trash2 className="w-3 h-3" />
                {t("adminPodcasts.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminPodcasts.shows.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("adminPodcasts.shows.confirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmId) remove.mutate(confirmId);
                setConfirmId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("adminPodcasts.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ShowEditor({
  s,
  onSave,
  onCancel,
  saving,
}: {
  s: PodcastShow;
  onSave: (s: PodcastShow) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const [d, setD] = useState<PodcastShow>(s);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const upd = (patch: Partial<PodcastShow>) => setD((prev) => ({ ...prev, ...patch }));

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg">
          {d.id ? t("adminPodcasts.showEditor.editTitle") : t("adminPodcasts.showEditor.newTitle")}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSave(d)} disabled={saving}>
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
            placeholder={t("adminPodcasts.showEditor.slugPlaceholder")}
          />
        </div>
        <div>
          <Label>Status</Label>
          <select
            className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
            value={d.status}
            onChange={(e) => upd({ status: e.target.value as PodcastStatus })}
          >
            <option value="draft">{t("adminPodcasts.showEditor.statusDraft")}</option>
            <option value="published">{t("adminPodcasts.showEditor.statusPublished")}</option>
            <option value="archived">{t("adminPodcasts.showEditor.statusArchived")}</option>
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
            <Label>{t("adminPodcasts.showEditor.fieldTitle")}</Label>
            <Input value={d.title_pl} onChange={(e) => upd({ title_pl: e.target.value })} />
          </div>
          <div>
            <Label>{t("adminPodcasts.showEditor.fieldDescription")}</Label>
            <Textarea
              rows={3}
              value={d.description_pl}
              onChange={(e) => upd({ description_pl: e.target.value })}
            />
          </div>
        </TabsContent>
        <TabsContent value="en" className="space-y-3 mt-4">
          <div>
            <Label>Title</Label>
            <Input value={d.title_en} onChange={(e) => upd({ title_en: e.target.value })} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={d.description_en}
              onChange={(e) => upd({ description_en: e.target.value })}
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>{t("adminPodcasts.showEditor.cover")}</Label>
          <div className="flex gap-2">
            <Input
              value={d.cover_image_url ?? ""}
              onChange={(e) => upd({ cover_image_url: e.target.value || null })}
              placeholder={t("adminPodcasts.showEditor.coverPlaceholder")}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setCoverPickerOpen(true)}
              title={t("adminPodcasts.showEditor.uploadCoverTitle")}
            >
              <Upload className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div>
          <Label>{t("adminPodcasts.showEditor.order")}</Label>
          <Input
            type="number"
            value={d.sort_order}
            onChange={(e) => upd({ sort_order: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <Label>Spotify URL</Label>
          <Input
            value={d.spotify_url ?? ""}
            onChange={(e) => upd({ spotify_url: e.target.value })}
            placeholder="https://open.spotify.com/show/…"
          />
        </div>
        <div>
          <Label>Apple URL</Label>
          <Input
            value={d.apple_url ?? ""}
            onChange={(e) => upd({ apple_url: e.target.value })}
            placeholder="https://podcasts.apple.com/…"
          />
        </div>
        <div>
          <Label>YouTube URL</Label>
          <Input
            value={d.youtube_url ?? ""}
            onChange={(e) => upd({ youtube_url: e.target.value })}
          />
        </div>
      </div>

      <MediaPickerDialog
        open={coverPickerOpen}
        onOpenChange={setCoverPickerOpen}
        onPick={(url) => upd({ cover_image_url: url })}
        accept="image"
        title={t("adminPodcasts.showEditor.pickCover")}
      />
    </section>
  );
}
