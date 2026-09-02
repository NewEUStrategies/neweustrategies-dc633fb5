// `/admin/podcasts` - POWŁOKA panelu podcastów.
//
// Plik miał 2072 linie i 205 funkcji: zapytania, payloady, cztery panele
// i cztery edytory warstw w jednym komponencie. Nic z tego nie dawało się
// zamontować w teście, więc warstwa pisząca do pięciu tabel stała na zerowym
// pokryciu. Po ekstrakcji zostaje tu wyłącznie SKLEJENIE:
//   * warstwa danych: `@/lib/podcast/queries` (klucze cache, zapytania, zapisy),
//   * czyste reguły: `@/lib/podcast/shape` (payloady, kaskady, selektory),
//   * widoki: `@/components/admin/podcasts/*`.
//
// BRAMKA ROLI JEST W TRASIE NADRZĘDNEJ. `routes/admin.tsx` przekierowuje
// każdego bez `isStaff` na `/login` - jedna bramka dla wszystkich tras panelu
// (patrz `routes/__tests__/adminRouteAuthority.gate.test.ts`). Ten plik jej nie
// dubluje i nie różnicuje uprawnień wewnątrz panelu.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
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
import { Mic, Plus, Settings } from "@/lib/lucide-shim";
import { ListTree } from "lucide-react";
import { EpisodeEditorPane } from "@/components/admin/podcasts/EpisodeEditorPane";
import { EpisodesListPane } from "@/components/admin/podcasts/EpisodesListPane";
import { PodcastSettingsPane } from "@/components/admin/podcasts/PodcastSettingsPane";
import { PodcastShowsPane } from "@/components/admin/podcasts/PodcastShowsPane";
import { useAuth } from "@/hooks/useAuth";
import type { Podcast } from "@/lib/podcast/types";
import { newEpisodeDraft, type PodcastStatusFilter } from "@/lib/podcast/shape";
import {
  useAdminPodcastRows,
  useAdminPodcastShows,
  useLoadAdminPodcast,
  useSaveAdminEpisode,
  useSoftDeleteAdminEpisode,
  type PodcastAdminMessages,
} from "@/lib/podcast/queries";
import { ensureI18n as ensureAdminPodcastsI18n } from "@/lib/i18n-admin-podcasts";

export const Route = createFileRoute("/admin/podcasts")({ component: Page });

/** Trzy wzajemnie wykluczające się widoki panelu (nawigacja przez stan). */
type View = "episodes" | "settings" | "shows";

function Page() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<Podcast | null>(null);
  // Fraza i filtr statusu trzymają się TUTAJ, nie w liście: przejście do
  // ustawień i z powrotem nie może czyścić zawężenia, na którym redakcja pracuje.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PodcastStatusFilter>("all");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [view, setView] = useState<View>("episodes");

  const { data: rows } = useAdminPodcastRows();
  // Programy - do etykiet na liście odcinków i selektora w edytorze.
  const { data: shows } = useAdminPodcastShows();

  // Komunikaty odmowy zapisu składamy tu, bo `t()` mieszka w komponencie -
  // warstwa danych dostaje gotowe napisy i nie musi znać i18n.
  const messages: PodcastAdminMessages = {
    slug: t("adminPodcasts.errors.slug"),
    audio: t("adminPodcasts.errors.audio"),
    tenant: t("adminPodcasts.errors.tenant"),
  };

  const loadOne = useLoadAdminPodcast({ onLoaded: setEditing });
  const save = useSaveAdminEpisode({
    tenantId,
    messages,
    onSaved: () => setEditing(null),
  });
  const remove = useSoftDeleteAdminEpisode();

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mic className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-2xl leading-tight">{t("adminPodcasts.title")}</h1>
              <p className="text-xs text-muted-foreground">{t("adminPodcasts.subtitle")}</p>
            </div>
          </div>
          {!editing && view === "episodes" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setView("shows")}>
                <ListTree className="w-4 h-4 mr-2" />
                {t("adminPodcasts.showsBtn")}
              </Button>
              <Button variant="outline" onClick={() => setView("settings")}>
                <Settings className="w-4 h-4 mr-2" />
                {t("adminPodcasts.settingsBtn")}
              </Button>
              <Button onClick={() => setEditing(newEpisodeDraft())}>
                <Plus className="w-4 h-4 mr-2" />
                {t("adminPodcasts.newEpisode")}
              </Button>
            </div>
          )}
        </div>

        {view === "settings" && !editing && (
          <PodcastSettingsPane onClose={() => setView("episodes")} />
        )}

        {view === "shows" && !editing && <PodcastShowsPane onClose={() => setView("episodes")} />}

        {view === "episodes" && !editing && (
          <EpisodesListPane
            rows={rows}
            shows={shows ?? []}
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onOpen={(id) => loadOne.mutate(id)}
            onRequestRemove={setConfirmId}
          />
        )}

        {editing && (
          <EpisodeEditorPane
            p={editing}
            shows={shows ?? []}
            onCancel={() => setEditing(null)}
            onSave={(bundle) => save.mutate(bundle)}
            saving={save.isPending}
          />
        )}
      </div>

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminPodcasts.confirmEpisodeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("adminPodcasts.confirmEpisodeDesc")}</AlertDialogDescription>
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
    </AdminShell>
  );
}
