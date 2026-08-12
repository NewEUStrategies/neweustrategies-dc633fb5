// Rząd twarzy składu - sześć osób z plakietką pod kursorem (A34).
//
// CO ZASTĄPIŁ. W tym miejscu stała iskra aktywności: czternaście słupków
// z liczbą różnych osób odzywających się danego dnia. Wykres był poprawną
// odpowiedzią na pytanie, którego członek klubu nie zadaje. Wchodząc na klub,
// którego nie zna, pyta "KTO tu jest", a nie "ilu ich było w środę" - i to
// jest różnica między modułem sieciującym a licznikiem ruchu.
//
// DLACZEGO SZEŚĆ I DLACZEGO ROTACYJNIE. Sześć awatarów `md` mieści się
// w kolumnie 20 rem w JEDNYM rzędzie, więc panel nie rośnie. Stała szóstka
// zamieniłaby jednak "skład klubu" w "sześć osób, które piszą najczęściej",
// czyli w usunięty ranking najaktywniejszych, tylko ładniejszy. Rotacja
// (`rotateRosterFaces`) przewija przez to samo miejsce cały skład, a osoby
// aktywne w ostatniej dobie zostają przypięte - to jedyny sygnał "tu ktoś
// jest" na całej stronie klubu i nie może zależeć od losu.
//
// OKNO ROTACJI JEST STAŁE W SESJI. Numer okna liczy się RAZ, przy montażu:
// skład, który przeskakuje w trakcie czytania, wygląda jak usterka, a nie
// jak rotacja. Zmiana przychodzi z następnym wejściem na stronę.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ClubPersonBadge,
  ClubPresenceAvatar,
} from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  rosterRotationTick,
  rotateRosterFaces,
  CLUB_ROSTER_FACE_SLOTS,
  type ClubRosterFace,
} from "@/lib/clubs/networkTypes";
import { topicLabel, type ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { CLUB_MEMBER_ROLES, type ClubMemberRole } from "@/lib/clubs/types";
import { formatDateShort, uiLang } from "@/lib/i18n/format";

// Jeden kształt wyzwalacza dla obu wariantów - link do profilu i przycisk
// odsłaniający plakietkę mają wyglądać identycznie, bo to jest ten sam awatar
// w tym samym rzędzie. Różnią się TYLKO tym, dokąd prowadzą.
const TRIGGER =
  "relative block rounded-lg ring-offset-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Rola z RPC zawężona do słownika klienta - nieznana wartość z nowszej
 *  migracji nie może wywrócić rzędu, więc degraduje do stanu domyślnego. */
function asRole(value: string): ClubMemberRole {
  return (CLUB_MEMBER_ROLES as readonly string[]).includes(value)
    ? (value as ClubMemberRole)
    : "member";
}

export function ClubRosterFaces({
  faces,
  topicCatalog,
  className,
}: {
  /** PULA z bazy, nie lista do pokazania - rotacja wybiera z niej sześć. */
  faces: readonly ClubRosterFace[];
  topicCatalog: readonly ClubTopicOption[];
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [tick] = useState(() => rosterRotationTick(Date.now()));
  const shown = rotateRosterFaces(faces, CLUB_ROSTER_FACE_SLOTS, tick);
  if (shown.length === 0) return null;

  return (
    // Jeden provider na cały rząd: wspólne opóźnienie znaczy, że po pierwszej
    // plakietce kolejne otwierają się natychmiast. Sześć osobnych providerów
    // kazałoby czekać przy każdym awatarze od nowa.
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      <ul
        aria-label={t("club.network.roster.facesLabel")}
        className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}
      >
        {shown.map((face) => {
          const role = asRole(face.role);
          const roleLabel = role === "member" ? null : t(`club.role.${role}`);
          const statusLabel = face.isActive
            ? t("club.network.roster.activeToday")
            : face.isNew
              ? t("club.network.roster.newHere")
              : face.joinedAt !== null
                ? t("club.network.roster.memberSince", {
                    date: formatDateShort(face.joinedAt, lang),
                  })
                : null;

          // Awatar jest `aria-hidden`, więc nazwę dostępną niesie ta warstwa -
          // i ona, a nie plakietka, jest wersją dla czytnika ekranu. Tooltip
          // bywa nieosiągalny przy dotyku, opis nie ma prawa być.
          const described = [face.name, roleLabel, face.headline, statusLabel]
            .filter((part): part is string => part !== null && part !== "")
            .join(" - ");

          const avatar = (
            <>
              <ClubPresenceAvatar
                name={face.name}
                avatarUrl={face.avatarUrl}
                active={face.isActive}
                size="md"
              />
              <span className="sr-only">{described}</span>
            </>
          );

          return (
            <li key={face.userId}>
              <ClubPersonBadge
                name={face.name}
                headline={face.headline}
                roleLabel={roleLabel}
                statusLabel={statusLabel}
                topics={face.topics.map((topic) => topicLabel(topic, lang, topicCatalog))}
              >
                {face.slug !== null ? (
                  <Link to="/author/$slug" params={{ slug: face.slug }} className={TRIGGER}>
                    {avatar}
                  </Link>
                ) : (
                  // Profil bez publicznej strony nie dostaje LINKU - katalog
                  // klubu nie może obchodzić ustawienia widoczności profilu.
                  //
                  // Ale nadal musi dać się DOSIĘGNĄĆ: plakietka niesie rolę,
                  // kompetencje i stan obecności, a `<span>` bez `tabindex`
                  // zamknąłby ją przed klawiaturą dokładnie tam, gdzie nie ma
                  // dokąd kliknąć. Przycisk bez `onClick` jest tu poprawny:
                  // jego rolą jest ODSŁONIĘCIE opisu, a nie nawigacja - i przy
                  // dotyku to on sprawia, że tapnięcie w awatar pokazuje
                  // plakietkę zamiast nie robić nic.
                  <button type="button" className={TRIGGER}>
                    {avatar}
                  </button>
                )}
              </ClubPersonBadge>
            </li>
          );
        })}
      </ul>
    </TooltipProvider>
  );
}
