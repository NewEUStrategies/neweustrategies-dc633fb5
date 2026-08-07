// Nagłówek strony głównej klubów.
//
// Mówi trzy rzeczy w tej kolejności: czym to jest, dla kogo jest, i - jeśli
// akurat dla ciebie nie jest - co z tym zrobić. Odznaka stanu dostępu stoi
// przy tytule, a nie w osobnym pasku pod spodem: informacja "masz dostęp" jest
// warta jednej linijki, nie własnego bloku.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { KeyRound, Lock, MailCheck, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClubHubAccess } from "@/lib/clubs/hubAccess";

const ACCESS_ICON: Record<ClubHubAccess, React.ComponentType<{ className?: string }>> = {
  member: ShieldCheck,
  invited: MailCheck,
  entitled: KeyRound,
  locked: Lock,
};

export function ClubHubHero({ access }: { access: ClubHubAccess }) {
  const { t } = useTranslation();
  const Icon = ACCESS_ICON[access];

  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold sm:text-4xl">{t("club.title")}</h1>
        <Badge variant={access === "locked" ? "outline" : "secondary"} className="gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {t(`club.hub.access.${access}`)}
        </Badge>
      </div>

      <p className="mt-2 max-w-2xl text-muted-foreground">{t("club.hub.lead")}</p>

      {access === "locked" ? (
        <div className="mt-5 rounded-xl border border-primary/30 bg-primary/[0.04] p-5">
          <h2 className="text-base font-semibold">{t("club.hub.upgradeTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("club.hub.upgradeBody")}
          </p>
          <div className="mt-4">
            <Button asChild size="sm">
              <Link to="/pricing">{t("club.hub.upgradeCta")}</Link>
            </Button>
          </div>
          {/* Bramka jest MIĘKKA: poniżej i tak stoi to, co baza dopuściła.
              Ta linijka mówi to wprost, żeby panel nie wyglądał na ścianę. */}
          <p className="mt-3 text-xs text-muted-foreground">{t("club.hub.upgradeNote")}</p>
        </div>
      ) : null}
    </header>
  );
}
