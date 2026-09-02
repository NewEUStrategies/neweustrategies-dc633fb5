// Plakietka statusu odcinka/programu - WYCIĄG z `routes/admin.podcasts.tsx`.
//
// Trzy stany mają trzy różne kolory i trzy różne etykiety ze słownika; ta sama
// plakietka stoi na liście odcinków, na liście programów i w podglądzie
// edytora, więc rozjazd między tymi miejscami byłby widoczny dla redakcji
// jako „ten sam odcinek ma dwa statusy".
import { useTranslation } from "react-i18next";
import type { PodcastStatus } from "@/lib/podcast/types";
import { ensureI18n as ensureAdminPodcastsI18n } from "@/lib/i18n-admin-podcasts";

export function PodcastStatusBadge({ status }: { status: PodcastStatus }) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const map: Record<PodcastStatus, string> = {
    published: "bg-green-500/10 text-green-700 dark:text-green-400",
    draft: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    archived: "bg-muted text-muted-foreground",
  };
  const label: Record<PodcastStatus, string> = {
    published: t("adminPodcasts.status.published"),
    draft: t("adminPodcasts.status.draft"),
    archived: t("adminPodcasts.status.archived"),
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${map[status]}`}>
      {label[status]}
    </span>
  );
}
