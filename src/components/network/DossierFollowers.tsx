// "Kto jeszcze śledzi ten plik" - obserwujący dossier trackera jako
// powierzchnia networkingowa. Widoczne wyłącznie dla zalogowanych; RPC
// zwraca tylko profile z opt-in discoverable w tenancie wołającego.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, UsersRound } from "lucide-react";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { ConnectButton } from "@/components/network/ConnectButton";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/lib/chat/presence";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useConnectionStatuses, usePolicyItemFollowers } from "@/lib/network/useConnections";
import "@/lib/i18n-network";

export function DossierFollowers({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const modules = useCommunityModules();
  const online = useOnlineUsers();
  const enabled = modules.connections_enabled && !!user;
  const followersQ = usePolicyItemFollowers(enabled ? itemId : null);
  const followers = followersQ.data ?? [];
  const statusesQ = useConnectionStatuses(followers.map((f) => f.user_id));

  if (!enabled || followers.length === 0) return null;

  return (
    <section className="mt-8" aria-label={t("network.dossierFollowersTitle")}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <UsersRound className="h-4 w-4 text-[var(--brand)]" aria-hidden />
        {t("network.dossierFollowersTitle")}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("network.dossierFollowersHint")}</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {followers.map((f) => (
          <li
            key={f.user_id}
            className="flex items-center gap-3 rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-border"
          >
            <ChatAvatar
              name={f.display_name}
              avatarUrl={f.avatar_url}
              online={online.has(f.user_id)}
              size="md"
            />
            <div className="min-w-0 flex-1">
              {f.slug ? (
                <Link
                  to="/author/$slug"
                  params={{ slug: f.slug }}
                  className="rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
                    <span className="truncate">{f.display_name}</span>
                    {f.verified && (
                      <BadgeCheck
                        className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
                        aria-label={t("people.verifiedBadge")}
                      />
                    )}
                  </p>
                </Link>
              ) : (
                <p className="truncate text-sm font-semibold">{f.display_name}</p>
              )}
              {(f.job_title || f.current_company) && (
                <p className="truncate text-xs text-muted-foreground">
                  {[f.job_title, f.current_company].filter(Boolean).join(" - ")}
                </p>
              )}
            </div>
            {/* Bez mapy statusów nie renderujemy przycisku - karta nie może
                odpytywać o status pojedynczo. */}
            {statusesQ.data && (
              <ConnectButton
                userId={f.user_id}
                displayName={f.display_name}
                state={statusesQ.data.get(f.user_id)}
                compact
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
