// Karty dla GOŚCIA na powierzchniach klubu, których RPC są dla `anon` zamknięte.
//
// PO CO. Tablica „Szukam / Oferuję”, katalog ekspertów i „Poznaj członka”
// czytają funkcje bez prawa EXECUTE dla `anon` (revoke modułu A32/A33). Gość,
// który trafiał tam z kafelka szyny albo z udostępnionego linku, dostawał
// ogólny komunikat awarii z przyciskiem ponowienia - który znów kończył się
// 42501. Odmowa nie jest awarią: czytelnik ma usłyszeć, że to decyzja klubu
// albo kwestia zalogowania, i dostać drogę dalej.
//
// DWIE KARTY, BO DWIE RÓŻNE PRAWDY:
//   * `ClubRosterHiddenCard` - powierzchnie z NAZWISKAMI (eksperci,
//     wyróżnienie). Dokładnie ta karta, którą trasa składu (`/members`)
//     pokazuje każdemu bez `can_see_members` - tam stała w miejscu i stąd
//     została wyjęta, żeby trzy powierzchnie o ludziach mówiły jednym zdaniem.
//   * `ClubMembersOnlyCard` - tablica ogłoszeń: to nie jest skład, tylko
//     narzędzie członków, więc karta zaprasza do zalogowania (te same klucze,
//     co minisite i katalog klubów: `club.membersOnly*`, `club.signIn`).
import { Link, useHydrated } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { currentReturnPath, loginSearch } from "@/lib/access/paywallLinks";

export function ClubRosterHiddenCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">
        {t("club.roster.hidden")}
      </CardContent>
    </Card>
  );
}

export function ClubMembersOnlyCard() {
  const { t } = useTranslation();
  // Powrót po zalogowaniu na TĘ stronę - ścieżka dopiero po hydratacji:
  // serwer nie zna `window`, a różny `href` serwera i klienta to błąd
  // hydratacji (ten sam wzorzec, co w `ClubAccessGate`).
  const hydrated = useHydrated();
  return (
    <Card data-testid="club-members-only">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <LogIn className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base font-semibold">{t("club.membersOnlyTitle")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t("club.membersOnlyBody")}</p>
        <Button asChild size="sm" className="rounded-lg">
          <Link
            to="/login"
            search={loginSearch({
              mode: "signin",
              next: hydrated ? currentReturnPath() : undefined,
              intent: "club",
            })}
          >
            {t("club.signIn")}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
