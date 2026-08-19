// Moduł "Poznaj członka" - jedna osoba na tydzień.
//
// PO CO. W klubie, w którym ludzie się nie znają, lista nazwisk nie tworzy
// znajomości. Trzy zdania o JEDNEJ osobie tygodniowo tworzą - bo dają temat
// do odezwania się i pokazują, że po drugiej stronie są konkretni ludzie,
// a nie awatary.
//
// TANIE W UTRZYMANIU Z DEFINICJI. Rotacja jest LICZONA po stronie bazy
// (numer tygodnia epoki modulo liczebność składu), więc moduł działa w klubie,
// w którym nikt nigdy nic nie wpisze. Redakcja może przypiąć własny opis na
// konkretny tydzień i wtedy on wygrywa - ale brak wpisu nie wyłącza modułu,
// tylko przełącza go z powrotem na rotację. Panel, który wymaga cotygodniowej
// pracy, przestaje działać w trzecim tygodniu.
//
// TRZY ZDANIA, NIE TRZY LINIJKI. Cięcie idzie po granicy zdania, nie po
// liczbie znaków: opis ucięty w połowie słowa i domknięty wielokropkiem czyta
// się jak awaria, a nie jak skrót. Logika stoi w `firstSentences` i ma własny
// test - to jest reguła produktowa, nie formatowanie.
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { Link } from "@tanstack/react-router";
import { UserRoundSearch } from "lucide-react";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { MoreLink } from "@/components/clubs/molecules/ClubHubContext";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubExpertiseChip } from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { MessageOrConnectButton } from "@/components/network/MessageOrConnectButton";
import { useClubSpotlight } from "@/lib/clubs/useClubNetwork";
import { spotlightBlurb } from "@/lib/clubs/networkTypes";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { topicLabel } from "@/lib/clubs/topicCatalog";

export function ClubSpotlightPanel({ clubSlug, clubId }: { clubSlug: string; clubId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { topics } = useClubTopics();
  const query = useClubSpotlight(clubId);
  const row = query.data ?? null;

  // Milczy, gdy nie ma kogo pokazać: klub ukrywający skład, klub jednoosobowy
  // i profil bez ani jednego zdania to trzy różne powody na ten sam wynik -
  // a moduł "poznaj członka" z pustym miejscem na osobę jest gorszy niż jego
  // brak.
  if (row === null) return null;

  const blurb = spotlightBlurb(row, lang);
  const name = row.display_name;

  return (
    <ClubRailPanel
      title={t("club.network.spotlight.title")}
      icon={UserRoundSearch}
      action={
        <MoreLink to="/club/$clubSlug/spotlight" clubSlug={clubSlug} label={t("club.hub.more")} />
      }
    >
      <div className="flex items-start gap-2.5">
        <ClubAuthorAvatar name={name} avatarUrl={row.avatar_url} size="md" />
        <div className="min-w-0 flex-1">
          {row.profile_slug !== null ? (
            <Link
              to="/author/$slug"
              params={{ slug: row.profile_slug }}
              className="block truncate text-sm font-semibold leading-tight hover:text-primary"
            >
              {name}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          )}
          {row.headline !== null ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {row.headline}
            </p>
          ) : null}
        </div>
        <DirectMessageButton
          userId={row.user_id}
          displayName={name}
          displayAvatar={row.avatar_url}
          compact
        />
      </div>

      {blurb !== "" ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{blurb}</p>
      ) : null}

      {row.topics.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.topics.slice(0, 3).map((topic) => (
            <ClubExpertiseChip key={topic} label={topicLabel(topic, lang, topics)} />
          ))}
        </div>
      ) : null}
    </ClubRailPanel>
  );
}
