// Jedno miejsce, w którym w klubie coś się PISZE.
//
// PO CO SCALENIE. Do tej pory nad strumieniem stały dwie karty obok siebie:
// "Podziel się czymś z klubem" (wpis) i "Rozpocznij dyskusję" (wątek).
// Dwie powierzchnie o tym samym zamiarze zmuszały do wyboru, ZANIM
// użytkownik w ogóle napisał zdanie - a różnica między nimi jest różnicą
// formy, nie intencji. Zakładki robią z tego jedną decyzję, podjętą wewnątrz
// jednej karty, z domyślną formą krótką (wpis), bo tak wygląda 90% ruchu.
//
// ZAKŁADKA "STWÓRZ DYSKUSJĘ" jest wyborem MIEJSCA, nie formularzem: pełny
// kompozytor (tytuł, treść, kotwica, anonimowość) żyje na /new i tam zostaje.
// Tutaj wskazuje się cel - istniejący wątek albo dział klubu - i rodzaj
// wypowiedzi; reszta jedzie parametrami adresu.
import { useMemo, useState } from "react";
import { uiLang } from "@/lib/i18n/format";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HelpCircle, MessageSquarePlus, PenLine, Scale, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubPostComposer } from "@/components/clubs/molecules/ClubPostComposer";
import { clubGroupName } from "@/components/clubs/molecules/ClubGroupTree";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClubGroupRow, ClubThreadKind, ClubThreadListRow } from "@/lib/clubs/types";

/** Skróty rodzajów. Trzy, nie sześć: to ma być zachęta, nie pełna droplista. */
const KINDS: ReadonlyArray<{ kind: ClubThreadKind; icon: LucideIcon }> = [
  { kind: "discussion", icon: MessageSquarePlus },
  { kind: "question", icon: HelpCircle },
  { kind: "position", icon: Scale },
];

const NEW_THREAD = "new";
const GROUP_PREFIX = "g:";
const THREAD_PREFIX = "t:";

type CreateTab = "post" | "thread";

export function ClubCreatePanel({
  clubSlug,
  clubId,
  groupId,
  groups,
  threads,
  canPost,
  canPostThread,
  whoCanPost,
  className,
}: {
  clubSlug: string;
  clubId: string;
  /** Aktywne zawężenie działu - staje się domyślnym celem nowej dyskusji. */
  groupId: string | null;
  groups: readonly ClubGroupRow[];
  threads: readonly ClubThreadListRow[];
  canPost: boolean;
  canPostThread: boolean;
  /** Z `clubs.who_can_post` - zdanie o tym, kto zakłada tematy w tym klubie. */
  whoCanPost: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [tab, setTab] = useState<CreateTab>(canPost ? "post" : "thread");
  const [kind, setKind] = useState<ClubThreadKind>("discussion");
  const [target, setTarget] = useState<string>(
    groupId === null ? NEW_THREAD : `${GROUP_PREFIX}${groupId}`,
  );

  const postableGroups = useMemo(() => groups.filter((g) => g.can_post_thread), [groups]);
  const selectedThread = target.startsWith(THREAD_PREFIX)
    ? (threads.find((thread) => thread.slug === target.slice(THREAD_PREFIX.length)) ?? null)
    : null;
  const selectedGroupId = target.startsWith(GROUP_PREFIX)
    ? target.slice(GROUP_PREFIX.length)
    : null;

  // Nikt tu nic nie napisze - jedna linia zamiast dwóch pustych zakładek.
  if (!canPost && !canPostThread) {
    return (
      <p className={cn(HUB_SURFACE, "px-4 py-3 text-sm text-muted-foreground", className)}>
        {t(`club.hub.composer.closed.${whoCanPost === "members" ? "members" : "moderators"}`)}
      </p>
    );
  }

  const activeTab: CreateTab = tab === "post" && !canPost ? "thread" : tab;

  return (
    <section className={cn(HUB_SURFACE, "p-3.5 sm:p-4", className)} data-testid="club-create-panel">
      <div
        role="tablist"
        aria-label={t("club.hub.create.tabs.post")}
        className="mb-3 inline-flex rounded-lg border border-border/70 p-0.5"
      >
        {(["post", "thread"] as const).map((value) => {
          const disabled = value === "post" ? !canPost : !canPostThread;
          const selected = activeTab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {t(`club.hub.create.tabs.${value}`)}
            </button>
          );
        })}
      </div>

      {activeTab === "post" ? (
        <ClubPostComposer clubId={clubId} groupId={groupId} canPost={canPost} chromeless />
      ) : !canPostThread ? (
        <p className="text-sm text-muted-foreground">
          {t(`club.hub.composer.closed.${whoCanPost === "members" ? "members" : "moderators"}`)}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("club.hub.create.targetLabel")}
            </span>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-9 rounded-lg text-sm">
                <SelectValue placeholder={t("club.hub.create.targetPlaceholder")} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={NEW_THREAD}>{t("club.hub.create.newThread")}</SelectItem>
                {postableGroups.length > 0 ? (
                  <div
                    className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    aria-hidden="true"
                  >
                    {t("club.hub.create.groupsHeading")}
                  </div>
                ) : null}
                {postableGroups.map((group) => (
                  <SelectItem key={group.id} value={`${GROUP_PREFIX}${group.id}`}>
                    {clubGroupName(group, lang)}
                  </SelectItem>
                ))}
                {threads.length > 0 ? (
                  <div
                    className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    aria-hidden="true"
                  >
                    {t("club.hub.create.threadsHeading")}
                  </div>
                ) : null}
                {threads.slice(0, 30).map((thread) => (
                  <SelectItem key={thread.id} value={`${THREAD_PREFIX}${thread.slug}`}>
                    {thread.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Rodzaj dotyczy WYŁĄCZNIE nowego wątku: dopisanie się do istniejącej
              rozmowy jest odpowiedzią, a odpowiedź nie ma rodzaju. */}
          {selectedThread === null ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                {t("club.hub.create.kindLabel")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map(({ kind: value, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      kind === value
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {t(`club.kind.${value}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {selectedThread !== null ? (
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug, threadSlug: selectedThread.slug }}
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <PenLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("club.hub.create.continueThread")}
            </Link>
          ) : (
            <Link
              to="/club/$clubSlug/new"
              params={{ clubSlug }}
              search={selectedGroupId === null ? { kind } : { kind, groupId: selectedGroupId }}
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <PenLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("club.hub.create.start")}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
