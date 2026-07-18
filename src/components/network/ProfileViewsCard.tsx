// Karta „Kto oglądał Twój profil" (LinkedIn-style). Widoczna wyłącznie
// właścicielowi profilu w zakładce Activity. Renderuje:
//   - liczniki 7/30/90 dni (RPC `profile_view_stats`)
//   - listę widzów uwzględniającą tryb prywatności viewera (RPC
//     `my_profile_viewers`) - anonimowi widzowie są maskowani w bazie,
//     prywatni w ogóle nie trafiają na listę.
//   - kontroler mojego trybu prywatności (public/anonymous/private).
// Klient nie zna id anonimowego widza, więc awatar/nazwa są ukryte;
// dla publicznych widzów link prowadzi do /author/{slug|id}.
import { useTranslation } from "react-i18next";
import { Eye, User as UserIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useMyProfileViewers,
  useMyProfileViewStats,
  useMyProfileViewMode,
  useUpdateProfileViewMode,
  type ProfileViewMode,
  type ProfileViewer,
} from "@/lib/network/useProfileViews";
import "@/lib/i18n-network";

function relativeTime(iso: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(diffMs / 60_000));
  if (mins < 1) return t("network.profileViews.justNow");
  if (mins < 60) return t("network.profileViews.minutesAgo", { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("network.profileViews.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("network.profileViews.daysAgo", { count: days });
}

function ViewerRow({ viewer }: { viewer: ProfileViewer }) {
  const { t } = useTranslation();
  const isAnon = viewer.viewer_mode !== "public";
  const displayName = isAnon
    ? t("network.profileViews.anonymousViewer")
    : (viewer.display_name?.trim() || t("network.profileViews.anonymousViewer"));
  const subtitle = !isAnon
    ? [viewer.job_title, viewer.company].filter(Boolean).join(" - ")
    : "";
  const avatar = !isAnon && viewer.avatar_url ? viewer.avatar_url : null;

  const inner = (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <UserIcon
            className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground"
            aria-hidden
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{displayName}</div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>
      <div className="shrink-0 text-[11px] text-muted-foreground">
        {relativeTime(viewer.viewed_at, t)}
      </div>
    </div>
  );

  if (!isAnon && viewer.viewer_id) {
    return (
      <Link
        to="/author/$slug"
        params={{ slug: viewer.viewer_id }}
        className="block no-underline"
      >
        {inner}
      </Link>
    );
  }
  return <div>{inner}</div>;
}

export function ProfileViewsCard() {
  const { t } = useTranslation();
  const viewersQ = useMyProfileViewers(20);
  const statsQ = useMyProfileViewStats();
  const modeQ = useMyProfileViewMode();
  const updateMode = useUpdateProfileViewMode();

  const viewers = viewersQ.data ?? [];
  const stats = statsQ.data;
  const mode: ProfileViewMode = modeQ.data ?? "public";

  return (
    <div className="space-y-4">
      {/* Liczniki */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { key: "last_7" as const, label: t("network.profileViews.last7") },
          { key: "last_30" as const, label: t("network.profileViews.last30") },
          { key: "last_90" as const, label: t("network.profileViews.last90") },
        ].map((c) => (
          <div
            key={c.key}
            className="rounded-md border border-border bg-background/60 p-3 text-center"
          >
            <div className="text-lg font-bold text-foreground tabular-nums">
              {statsQ.isPending ? (
                <Skeleton className="mx-auto h-5 w-10" />
              ) : (
                (stats?.[c.key] ?? 0)
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Tryb prywatności */}
      <div className="rounded-md border border-border bg-background/60 p-3">
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("network.profileViews.privacyLabel")}
        </label>
        <Select
          value={mode}
          onValueChange={(v) => {
            if (v === "public" || v === "anonymous" || v === "private") {
              updateMode.mutate(v);
            }
          }}
          disabled={modeQ.isPending || updateMode.isPending}
        >
          <SelectTrigger className="h-8 w-full max-w-sm text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">{t("network.profileViews.modePublic")}</SelectItem>
            <SelectItem value="anonymous">
              {t("network.profileViews.modeAnonymous")}
            </SelectItem>
            <SelectItem value="private">{t("network.profileViews.modePrivate")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {t("network.profileViews.privacyHint")}
        </p>
      </div>

      {/* Lista widzów */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          <span>{t("network.profileViews.subtitle")}</span>
        </div>
        {viewersQ.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : viewers.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-background/40 p-4 text-center text-xs italic text-muted-foreground">
            {mode === "private"
              ? t("network.profileViews.privacyHint")
              : t("network.profileViews.empty")}
          </p>
        ) : (
          <div className="divide-y divide-border/60 rounded-md border border-border bg-background/60">
            {viewers.map((v, idx) => (
              <ViewerRow key={`${v.viewer_id}-${v.viewed_at}-${idx}`} viewer={v} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
