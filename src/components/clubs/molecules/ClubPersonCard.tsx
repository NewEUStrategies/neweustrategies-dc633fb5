// Molekuła: karta osoby na pełnym ekranie klubu.
//
// PO CO OSOBNY BYT. Trzy powierzchnie mówią o człowieku w pełnej skali -
// katalog ekspertów, lista obecnych na spotkaniu i skład. Wiersz w szynie
// odpowiada na pytanie "ilu ich jest"; karta odpowiada na "kto to jest
// i dlaczego mam się do niego odezwać", więc niesie stanowisko, kompetencje
// i ślad pracy w tym klubie.
//
// Trzy kopie tej karty rozjechałyby się przy pierwszej zmianie - dokładnie
// tak, jak rozjechał się chip obszaru, zanim dostał wspólny `ClubTopicChip`.
//
// AKCJE SĄ SLOTEM, nie propsem-listą: na spotkaniu przy osobie stoi stan
// obecności, w katalogu - „poproś o zdanie", a w składzie nic. Karta nie ma
// powodu wiedzieć, która z tych rzeczy jest na ekranie.
import type { ReactNode } from "react";
import { uiLang } from "@/lib/i18n/format";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ClubPresenceAvatar,
  ClubExpertiseChip,
} from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { topicLabel, type ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { CLUB_MEMBER_ROLES, type ClubMemberRole } from "@/lib/clubs/types";

/** Rola z RPC zawężona do słownika klienta - nieznana wartość z nowszej
 *  migracji nie może wywrócić listy, więc degraduje do stanu domyślnego. */
function asRole(value: string): ClubMemberRole {
  return (CLUB_MEMBER_ROLES as readonly string[]).includes(value)
    ? (value as ClubMemberRole)
    : "member";
}

export function ClubPersonCard({
  name,
  avatarUrl,
  profileSlug,
  headline,
  role,
  topics,
  topicCatalog,
  active = false,
  meta,
  actions,
  className,
}: {
  name: string;
  avatarUrl: string | null;
  profileSlug: string | null;
  headline: string | null;
  /** Rola W KLUBIE. `member` to stan domyślny i nie dostaje plakietki. */
  role?: string | null;
  topics?: readonly string[];
  topicCatalog?: readonly ClubTopicOption[];
  /** Odezwał się w ostatniej dobie - kropka przy awatarze. */
  active?: boolean;
  /** Linijka pod stanowiskiem: dorobek, data dołączenia, stan obecności. */
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const normalizedRole = role === null || role === undefined ? null : asRole(role);

  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/40 sm:p-4",
        className,
      )}
    >
      <ClubPresenceAvatar name={name} avatarUrl={avatarUrl} active={active} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {profileSlug !== null ? (
            <Link
              to="/author/$slug"
              params={{ slug: profileSlug }}
              className="min-w-0 truncate text-sm font-medium hover:text-primary"
            >
              {name}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium">{name}</span>
          )}
          {normalizedRole !== null && normalizedRole !== "member" ? (
            <Badge variant="outline" className="shrink-0 rounded-lg text-[10px]">
              {t(`club.role.${normalizedRole}`)}
            </Badge>
          ) : null}
        </div>

        {headline !== null ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{headline}</p>
        ) : null}

        {topics !== undefined && topics.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {topics.slice(0, 4).map((topic) => (
              <ClubExpertiseChip key={topic} label={topicLabel(topic, lang, topicCatalog ?? [])} />
            ))}
            {topics.length > 4 ? (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                +{topics.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}

        {meta !== undefined ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">{meta}</p>
        ) : null}

        {actions !== undefined ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
    </article>
  );
}
