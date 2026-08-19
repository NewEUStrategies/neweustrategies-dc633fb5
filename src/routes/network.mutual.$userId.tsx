// Lista wspólnych kontaktów między zalogowanym użytkownikiem a wskazaną osobą.
// Widok wykorzystuje RPC mutual_connections (SECURITY DEFINER, tenant-scoped).
// Powrót do profilu tej osoby jest zapewniony w nagłówku.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, MapPin, Users, UsersRound } from "lucide-react";
import { AuthGate } from "@/components/profile/AuthGate";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { DegreeBadge } from "@/components/network/atoms/DegreeBadge";
import { NetworkDistance } from "@/components/network/organisms/NetworkDistance";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/lib/chat/presence";
import { ensureI18n as ensureNetworkI18n } from "@/lib/i18n-network";

type MutualRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  slug: string | null;
  verified: boolean;
  total_count: number;
};

type TargetProfile = {
  id: string;
  slug: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

export const Route = createFileRoute("/network/mutual/$userId")({
  component: MutualConnectionsPage,
  head: () => ({
    meta: [
      { title: "Wspólne kontakty - New EU Strategies" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Lista wspólnych kontaktów w Twojej sieci." },
    ],
  }),
});

function MutualConnectionsPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-network.ts.
  ensureNetworkI18n();
  const { userId } = Route.useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useOnlineUsers();

  const targetQ = useQuery({
    queryKey: ["profile-basic", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<TargetProfile | null> => {
      const { data, error } = await supabase
        .from("profiles_public")
        .select("id, slug, display_name, first_name, last_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data as TargetProfile | null) ?? null;
    },
  });

  const mutualQ = useQuery({
    queryKey: ["mutual-connections", user?.id, userId],
    enabled: !!user && !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<MutualRow[]> => {
      const { data, error } = await supabase.rpc("mutual_connections", {
        p_user_id: userId,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as unknown as MutualRow[];
    },
  });

  const target = targetQ.data;
  const targetName =
    target?.display_name?.trim() ||
    [target?.first_name, target?.last_name].filter(Boolean).join(" ").trim() ||
    "";
  const rows = mutualQ.data ?? [];
  const total = rows[0]?.total_count ?? 0;

  return (
    <AuthGate>
      <div id="main-content" className="mx-auto w-full max-w-3xl px-4 py-6 md:py-10">
        <header className="mb-6 flex flex-col gap-3">
          {target?.slug ? (
            <Link
              to="/author/$slug"
              params={{ slug: target.slug }}
              className="inline-flex w-fit items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--brand)]/10 hover:text-[var(--brand)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {targetName
                ? t("network.backToProfileOf", { name: targetName })
                : t("network.backToProfile")}
            </Link>
          ) : null}
          <div className="flex items-start gap-3">
            {target ? (
              <ChatAvatar
                name={targetName || "User"}
                avatarUrl={target.avatar_url}
                online={online.has(userId)}
                size="md"
                to={target.slug ? `/author/${target.slug}` : undefined}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-lg font-semibold leading-tight">
                <UsersRound className="h-4 w-4 text-[var(--brand)]" aria-hidden />
                {t("network.mutualPageTitle")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {targetName
                  ? t("network.mutualPageSubtitle", { name: targetName })
                  : t("network.mutualPageSubtitleGeneric")}
              </p>
              {/* Podsumowanie drogi nad pełną listą mostów: jeden stopień,
                  jedna ścieżka, potem dopiero wszystkie warianty niżej. */}
              {targetName ? (
                <NetworkDistance
                  userId={userId}
                  displayName={targetName}
                  avatarUrl={target?.avatar_url}
                  className="mt-1.5"
                />
              ) : null}
            </div>
          </div>
        </header>

        {mutualQ.isLoading ? (
          <ul className="grid gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <li
                key={i}
                className="h-16 animate-pulse rounded-[6px] border border-border/60 bg-muted/40"
              />
            ))}
          </ul>
        ) : mutualQ.isError ? (
          <div className="rounded-[6px] border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
            {/* Klucz istniał w słowniku - `defaultValue` tylko przesłaniał go
                własnym wariantem tekstu, rozjeżdżając PL z EN. */}
            {t("network.loadError")}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[6px] border border-dashed border-border/70 p-10 text-center">
            <Users className="h-6 w-6 text-muted-foreground/50" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("network.mutualEmpty")}</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("network.mutual", { count: total })}
            </p>
            <ul className="grid gap-3">
              {rows.map((r) => (
                <li
                  key={r.user_id}
                  className="flex items-center gap-3 rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-border"
                >
                  <ChatAvatar
                    name={r.display_name}
                    avatarUrl={r.avatar_url}
                    online={online.has(r.user_id)}
                    size="md"
                    to={r.slug ? `/author/${r.slug}` : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    {r.slug ? (
                      <Link
                        to="/author/$slug"
                        params={{ slug: r.slug }}
                        className="block rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
                          <span className="truncate">{r.display_name}</span>
                          {/* Każdy most jest moim kontaktem 1. stopnia - to on
                              robi z tej listy listę realnych dróg. */}
                          <DegreeBadge degree={1} />
                          {r.verified && (
                            <BadgeCheck
                              className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
                              aria-label={t("people.verifiedBadge")}
                            />
                          )}
                        </p>
                      </Link>
                    ) : (
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
                        <span className="truncate">{r.display_name}</span>
                        <DegreeBadge degree={1} />
                      </p>
                    )}
                    {(r.job_title || r.current_company) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {[r.job_title, r.current_company].filter(Boolean).join(" - ")}
                      </p>
                    )}
                    {r.location && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground/80">
                        <MapPin className="h-3 w-3" aria-hidden />
                        {r.location}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <DirectMessageButton
                      userId={r.user_id}
                      displayName={r.display_name}
                      connectionState={{
                        status: "connected",
                        connectionId: null,
                        mutualCount: 0,
                        canInvite: false,
                        degree: 1,
                        bridge: null,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AuthGate>
  );
}
