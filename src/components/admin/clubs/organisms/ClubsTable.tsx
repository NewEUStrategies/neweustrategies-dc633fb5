// Organizm: tabela klubów w panelu - KOMPOZYCJA, nie logika.
//
// Responsywność: na wąskim ekranie tabela zamienia się w listę kart, a nie
// w poziomy scroll. Poziomy scroll w tabeli administracyjnej oznacza, że
// kolumna "Akcje" jest niewidoczna dokładnie wtedy, gdy jest potrzebna.
//
// CO STĄD WYSZŁO I GDZIE JEST. Ten plik miał treść wiersza wpisaną DWA RAZY (raz
// jako `<tr>`, raz jako karta), a razem z nią dwie kopie zawężania kolumn
// CHECK-owych (`asStatus`/`asVisibility`), formatowania daty i decyzji o kresce
// w pustej komórce. Reguły są teraz w `lib/clubs/adminClubsTable.ts`
// (`clubsTableRowViews` - jedna projekcja wiersza dla OBU układów), a znacznik
// w molekułach `ClubTableRow` i `ClubTableCard`. Tutaj zostaje wyłącznie
// sklejenie: nagłówek kolumn i dwie listy z tych samych widoków.
import { useTranslation } from "react-i18next";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClubTableCard } from "../molecules/ClubTableCard";
import { ClubTableRow } from "../molecules/ClubTableRow";
import { clubsTableRowViews } from "@/lib/clubs/adminClubsTable";
import type { AdminClubRow } from "@/lib/clubs/types";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

interface ClubsTableProps {
  rows: AdminClubRow[];
}

export function ClubsTable({ rows }: ClubsTableProps) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  // Język TREŚCI (bliźniacze kolumny nazw klubów) i kod języka DATY wyprowadza
  // `clubsTableRowViews` z surowego `i18n.language` - o jedno miejsce mniej,
  // w którym ta decyzja może się rozjechać.
  const views = clubsTableRowViews(rows, i18n.language);

  return (
    <>
      {/* Widok tabelaryczny od lg w górę */}
      <div className="hidden lg:block rounded-lg border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("adminClubs.columns.name")}</TableHead>
              <TableHead>{t("adminClubs.columns.visibility")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.groups")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.members")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.threads")}</TableHead>
              <TableHead className="text-right">{t("adminClubs.columns.pending")}</TableHead>
              <TableHead>{t("adminClubs.columns.leads")}</TableHead>
              <TableHead>{t("adminClubs.columns.lastActivity")}</TableHead>
              <TableHead>{t("adminClubs.columns.status")}</TableHead>
              <TableHead className="w-10 sr-only">{t("adminClubs.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {views.map((view) => (
              <ClubTableRow key={view.id} view={view} />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Karty poniżej lg - te same dane, układ pionowy */}
      <div className="grid gap-3 lg:hidden">
        {views.map((view) => (
          <ClubTableCard key={view.id} view={view} />
        ))}
      </div>
    </>
  );
}
