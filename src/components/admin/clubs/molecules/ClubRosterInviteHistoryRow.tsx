// Molekuła: WIERSZ HISTORII ZAPROSZEŃ.
//
// CO BYŁA W ORGANIZMIE. Element `(invitationsQ.data ?? []).map()` składający
// trzy klucze słownika wprost w JSX-ie - w tym klucz statusu, którego prefiks
// był literówką (`invites` zamiast `invitations`), więc `t()` zawsze schodziło
// do `defaultValue` i wypisywało surowy status z bazy.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jeden wpis historii. Wszystkie cztery kanały
// wejścia (`CLUB_INVITE_CHANNELS`) lądują w jednej liście, bo administrator
// pyta „kogo zaprosiliśmy”, a nie „kogo zaprosiliśmy którą tabelą”.
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ClubInvitationView } from "@/lib/clubs/adminClubInvites";
import { formatDateShort } from "@/lib/i18n/format";

export function ClubRosterInviteHistoryRow({
  view,
  language,
}: {
  view: ClubInvitationView;
  language: string | undefined;
}) {
  const { t } = useTranslation();

  return (
    <TableRow>
      <TableCell className="font-medium">{view.recipient}</TableCell>
      <TableCell>
        <Badge variant="outline">{t(view.channelKey)}</Badge>
      </TableCell>
      <TableCell>{t(view.roleKey)}</TableCell>
      <TableCell className="text-sm">{t(view.statusKey)}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{view.inviter}</TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatDateShort(view.createdAt, language)}
      </TableCell>
    </TableRow>
  );
}
