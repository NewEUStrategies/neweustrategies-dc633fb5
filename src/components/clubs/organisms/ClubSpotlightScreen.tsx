// Organizm: pełny ekran "Poznaj członka".
//
// TRZY WARSTWY, KAŻDA Z INNYM ADRESATEM:
//
//   1. OSOBA TEGO TYGODNIA - duża karta z pełnym opisem, kompetencjami
//      i drogą do rozmowy. To jest cała treść modułu dla zwykłego członka.
//   2. REDAKCJA - formularz przypięcia. Bez niego tabela `club_member_spotlight`
//      nie miałaby ANI JEDNEJ drogi zapisu poza panelem administracyjnym,
//      którego prowadzący klub nie widzi. Dokładnie ten sam martwy tor, co
//      `club_set_role` przed dodaniem droplisty na ekranie składu.
//   3. ARCHIWUM - kto był przedstawiony wcześniej. Zawiera WYŁĄCZNIE
//      przypięcia redakcyjne, bo rotacja jest liczona, a nie zapisywana,
//      i nie zostawia śladu z definicji. Ta asymetria jest wprost powiedziana
//      w interfejsie, żeby brak wpisów nie wyglądał jak gubienie danych.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarRange, Loader2, Pin, Trash2, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubExpertiseChip } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { useClubMembers } from "@/lib/clubs/useClubs";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import {
  useClubSpotlight,
  useClubSpotlightHistory,
  useDeleteClubSpotlight,
  usePinClubSpotlight,
} from "@/lib/clubs/useClubNetwork";
import { mondayOf, spotlightBlurb } from "@/lib/clubs/networkTypes";
import { topicLabel } from "@/lib/clubs/topicCatalog";
import { formatDate, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

/** Formularz przypięcia - widoczny wyłącznie dla prowadzenia klubu. */
function PinForm({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const membersQ = useClubMembers({ clubId, status: "active", limit: 100 });
  const pin = usePinClubSpotlight(clubId);

  const [userId, setUserId] = useState("");
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [blurbPl, setBlurbPl] = useState("");
  const [blurbEn, setBlurbEn] = useState("");

  const members = membersQ.data?.rows ?? [];
  const ready = userId !== "";

  return (
    <section className="rounded-lg border border-border/60 bg-card p-3 sm:p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Pin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t("club.network.spotlight.pinTitle")}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("club.network.spotlight.pinLead")}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="spotlight-member" className="text-sm">
            {t("club.network.spotlight.member")}
          </Label>
          <Select value={userId} onValueChange={setUserId} disabled={membersQ.isPending}>
            <SelectTrigger id="spotlight-member" className="w-full rounded-lg">
              <SelectValue placeholder={t("club.network.spotlight.memberPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.user_id} value={member.user_id}>
                  {member.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="spotlight-week" className="text-sm">
            {t("club.network.spotlight.week")}
          </Label>
          {/* Dowolny dzień jest poprawny - RPC normalizuje go do poniedziałku
              tego tygodnia. Karanie redakcji błędem za wybranie środy byłoby
              podatkiem od tego, że kalendarz pokazuje dni, a nie tygodnie. */}
          <Input
            id="spotlight-week"
            type="date"
            value={week}
            onChange={(event) => setWeek(event.target.value)}
            className="rounded-lg"
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="spotlight-pl" className="text-sm">
            {t("club.network.spotlight.blurbPl")}
          </Label>
          <Textarea
            id="spotlight-pl"
            rows={3}
            value={blurbPl}
            onChange={(event) => setBlurbPl(event.target.value)}
            placeholder={t("club.network.spotlight.blurbPlaceholder")}
            className="rounded-lg"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="spotlight-en" className="text-sm">
            {t("club.network.spotlight.blurbEn")}
          </Label>
          <Textarea
            id="spotlight-en"
            rows={3}
            value={blurbEn}
            onChange={(event) => setBlurbEn(event.target.value)}
            placeholder={t("club.network.spotlight.blurbPlaceholder")}
            className="rounded-lg"
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("club.network.spotlight.blurbHint")}
      </p>

      <Button
        type="button"
        size="sm"
        className="mt-3 rounded-lg"
        disabled={!ready || pin.isPending}
        onClick={() =>
          pin.mutate(
            {
              userId,
              weekStart: week === "" ? null : week,
              blurbPl: blurbPl.trim() === "" ? null : blurbPl.trim(),
              blurbEn: blurbEn.trim() === "" ? null : blurbEn.trim(),
            },
            {
              onSuccess: () => {
                setBlurbPl("");
                setBlurbEn("");
                toast.success(t("club.network.spotlight.pinned"));
              },
              onError: () => toast.error(t("club.network.spotlight.pinFailed")),
            },
          )
        }
      >
        {pin.isPending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : null}
        {t("club.network.spotlight.pin")}
      </Button>
    </section>
  );
}

export function ClubSpotlightScreen({
  clubId,
  canModerate,
}: {
  clubId: string;
  canModerate: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { topics } = useClubTopics();
  const lang = uiLang(i18n.language);

  const currentQ = useClubSpotlight(clubId);
  const historyQ = useClubSpotlightHistory({ clubId });
  const remove = useDeleteClubSpotlight(clubId);

  const current = currentQ.data ?? null;
  const history = historyQ.data ?? [];
  // Bieżący tydzień stoi w wielkiej karcie wyżej - w archiwum byłby duplikatem.
  const past = history.filter((row) => !row.is_current);

  if (currentQ.isError) return <ClubErrorNotice onRetry={() => void currentQ.refetch()} />;

  return (
    <div className="space-y-4">
      {currentQ.isPending ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      ) : current === null ? (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
          <UserRoundSearch className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {t("club.network.spotlight.emptyClub")}
          </p>
        </div>
      ) : (
        <section className="rounded-lg border border-border/60 bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              <CalendarRange className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t("club.network.spotlight.thisWeek")}
            </span>
            {/* Skąd wzięła się ta osoba na ekranie - rotacja czy decyzja
                redakcji. Bez tego czytelnik nie wie, czy ktoś ją wybrał. */}
            <span className="text-[11px] text-muted-foreground">
              {current.curated
                ? t("club.network.spotlight.sourceCurated")
                : t("club.network.spotlight.sourceRotation")}
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
            <ClubAuthorAvatar
              name={current.display_name}
              avatarUrl={current.avatar_url}
              size="md"
            />
            <div className="min-w-0 flex-1">
              {current.profile_slug !== null ? (
                <Link
                  to="/author/$slug"
                  params={{ slug: current.profile_slug }}
                  className="text-xl font-semibold leading-tight hover:text-primary sm:text-2xl"
                >
                  {current.display_name}
                </Link>
              ) : (
                <h2 className="text-xl font-semibold leading-tight sm:text-2xl">
                  {current.display_name}
                </h2>
              )}
              {current.headline !== null ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{current.headline}</p>
              ) : null}

              <p className="mt-3 max-w-2xl text-sm leading-relaxed">
                {spotlightBlurb(current, lang)}
              </p>

              {current.topics.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {current.topics.map((topic) => (
                    <ClubExpertiseChip key={topic} label={topicLabel(topic, lang, topics)} />
                  ))}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <DirectMessageButton
                  userId={current.user_id}
                  displayName={current.display_name}
                  displayAvatar={current.avatar_url}
                />
                {current.profile_slug !== null ? (
                  <Button asChild variant="outline" size="sm" className="rounded-lg">
                    <Link to="/author/$slug" params={{ slug: current.profile_slug }}>
                      {t("club.network.spotlight.openProfile")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      )}

      {canModerate ? <PinForm clubId={clubId} /> : null}

      <section>
        <h2 className="text-sm font-semibold">{t("club.network.spotlight.archive")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("club.network.spotlight.archiveHint")}
        </p>

        {past.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            {t("club.network.spotlight.archiveEmpty")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {past.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3",
                )}
              >
                <ClubAuthorAvatar name={row.display_name} avatarUrl={row.avatar_url} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.profile_slug !== null ? (
                      <Link
                        to="/author/$slug"
                        params={{ slug: row.profile_slug }}
                        className="truncate text-sm font-medium hover:text-primary"
                      >
                        {row.display_name}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium">{row.display_name}</span>
                    )}
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {t("club.network.spotlight.weekOf", {
                        date: formatDate(row.week_start, lang, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }),
                      })}
                    </span>
                  </div>
                  {row.headline !== null ? (
                    <p className="truncate text-xs text-muted-foreground">{row.headline}</p>
                  ) : null}
                  {pickLocalized(row, "blurb", lang) !== "" ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {pickLocalized(row, "blurb", lang)}
                    </p>
                  ) : null}
                </div>

                {row.can_manage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground"
                    aria-label={t("club.network.spotlight.unpin")}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(row.id, {
                        onSuccess: () => toast.success(t("club.network.spotlight.unpinned")),
                        onError: () => toast.error(t("club.network.spotlight.pinFailed")),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
