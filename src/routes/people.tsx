// People directory - internal, registered-only search over opted-in profiles.
// Anonymous visitors see a sign-in gate; the route is noindex and disallowed
// in robots.txt, and the underlying RPC rejects anonymous callers anyway.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, MessagesSquare, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { AuthGate } from "@/components/profile/AuthGate";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { useAuth } from "@/hooks/useAuth";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { useOnlineUsers } from "@/lib/chat/presence";
import { usePeopleSearch, useStartConversation } from "@/lib/chat/useConversations";
import { useDiscoverable, useSetDiscoverable } from "@/lib/chat/useDiscoverable";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/people")({
  component: PeoplePage,
  head: () => ({
    meta: [{ title: "Osoby" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function PeoplePage() {
  const { t } = useTranslation();
  return (
    <AuthGate
      fallbackTitle={t("people.membersOnlyTitle")}
      fallbackBody={t("people.membersOnlyBody")}
    >
      <PeopleInner />
    </AuthGate>
  );
}

function DiscoverabilityBanner() {
  const { t } = useTranslation();
  const discoverableQ = useDiscoverable();
  const setDiscoverable = useSetDiscoverable();
  const on = discoverableQ.data ?? false;

  if (discoverableQ.isLoading) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[6px] border px-3 py-2.5",
        on ? "border-border/60 bg-muted/30" : "border-[var(--brand)]/40 bg-[var(--brand)]/5",
      )}
    >
      {on ? (
        <Eye className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <EyeOff className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug">
          {on ? t("people.discoverBannerOnTitle") : t("people.discoverBannerTitle")}
        </p>
        <p className="text-xs leading-snug text-muted-foreground">
          {on ? t("people.discoverBannerOnBody") : t("people.discoverBannerBody")}
        </p>
      </div>
      <Switch
        checked={on}
        disabled={setDiscoverable.isPending}
        onCheckedChange={(next) =>
          setDiscoverable.mutate(next, {
            onSuccess: () => toast.success(t("profilePrivacy.saved")),
            onError: () => toast.error(t("profilePrivacy.saveError")),
          })
        }
        aria-label={t("profilePrivacy.discoverableLabel")}
      />
    </div>
  );
}

function PeopleInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const online = useOnlineUsers();
  const start = useStartConversation();

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const peopleQ = usePeopleSearch(query, 50);
  const people = useMemo(() => peopleQ.data ?? [], [peopleQ.data]);

  if (!user) return null;

  return (
    <div className="container mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold leading-tight">{t("people.title")}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("people.subtitle")}</p>
      </header>

      <div className="mb-4">
        <DiscoverabilityBanner />
      </div>

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("people.searchPlaceholder")}
          aria-label={t("people.searchPlaceholder")}
          className="h-10 w-full rounded-[6px] border border-input bg-muted/30 !pl-[42px] pr-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {!peopleQ.isLoading && people.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("people.resultsCount", { count: people.length })}
        </p>
      )}

      {peopleQ.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-[6px] bg-muted/60" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[6px] border border-dashed border-border/70 p-10 text-center">
          <Users className="h-6 w-6 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {query ? t("people.empty") : t("people.emptyDirectory")}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex items-center gap-3 rounded-[6px] border border-border/60 bg-card p-3 transition-colors hover:border-border"
            >
              <ChatAvatar
                name={person.display_name}
                avatarUrl={person.avatar_url}
                online={online.has(person.id)}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{person.display_name}</p>
                {(person.job_title || person.current_company) && (
                  <p className="truncate text-xs text-muted-foreground">
                    {[person.job_title, person.current_company].filter(Boolean).join(" - ")}
                  </p>
                )}
                {person.specialization && (
                  <p className="truncate text-[11px] text-muted-foreground/80">
                    {person.specialization}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={start.isPending}
                onClick={() =>
                  start.mutate(person.id, {
                    onSuccess: (conversationId) => openChatWindow({ conversationId }),
                    onError: () => toast.error(t("chat.startError")),
                  })
                }
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                aria-label={`${t("people.message")}: ${person.display_name}`}
              >
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("people.message")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
