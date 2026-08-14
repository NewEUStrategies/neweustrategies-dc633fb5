// Molekuła: kafelek zaangażowania kampanii newslettera.
//
// CO SIĘ TU ZMIENIŁO I DLACZEGO. Panel pokazywał dwie liczby (`opens`,
// `clicks`) i dzielił je przez liczbę dostarczonych maili. Ponieważ do tabeli
// zdarzeń pisały RÓWNOLEGLE dwa producenty, a klient pocztowy potrafi pobrać
// piksel wielokrotnie, wynik potrafił przekroczyć 100% - a wskaźnik otwarć
// powyżej stu procent nie jest „trochę zawyżony", tylko nieprawdziwy, więc
// unieważnia cały kafelek razem z kliknięciami.
//
// Teraz kafelek mówi dwiema warstwami, bo mierzą co innego:
//   * ZASIĘG (`uniqueOpens` / `uniqueClicks`) - liczba RÓŻNYCH odbiorców.
//     To on jest licznikiem wskaźnika i z definicji nie przekroczy liczby
//     dostarczonych,
//   * zdarzenia (`opens` / `clicks`) - po jednym na odbiorcę i dobę UTC
//     (inwariant bazy, migracja 20260814150000), czyli miara POWRACANIA do
//     wiadomości w kolejnych dniach.
//
// Wskaźnik jest dodatkowo przycięty do 100%: gdyby kiedykolwiek znów wyszedł
// wyżej (dane sprzed deduplikacji, ręczna korekta `sent_count`), użytkownik
// zobaczy sufit i notę, a nie liczbę, w którą nie sposób uwierzyć.
import { useTranslation } from "react-i18next";
import { MailOpen, MousePointerClick } from "lucide-react";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminMetricTile } from "@/components/admin/molecules/AdminMetricTile";
import { engagementRate } from "@/lib/newsletter/engagementRate";
// `import type` znika w buildzie, a wiąże kafelek z kontraktem funkcji
// serwerowej: zmiana kształtu zwrotki jest błędem KOMPILACJI tutaj, a nie
// cichym zerem na ekranie.
import type { CampaignEngagement } from "@/lib/newsletter-campaigns.functions";

// Molekuła rejestruje własny słownik (precedens: PopupEventsPanel), więc jest
// samowystarczalna - nie zależy od tego, czy trasa pamiętała o `ensureI18n`.
ensureNewsletterAdminI18n();

interface CampaignEngagementCardProps {
  /** Zasięg i liczba zdarzeń; `undefined` w trakcie ładowania. */
  engagement: CampaignEngagement | undefined;
  /** Mianownik wskaźnika: liczba dostarczonych wiadomości w kampanii. */
  delivered: number;
  className?: string;
}

export function CampaignEngagementCard({
  engagement,
  delivered,
  className,
}: CampaignEngagementCardProps) {
  const { t } = useTranslation();

  const uniqueOpens = engagement?.uniqueOpens ?? 0;
  const uniqueClicks = engagement?.uniqueClicks ?? 0;
  const openRate = engagementRate(uniqueOpens, delivered);
  const clickRate = engagementRate(uniqueClicks, delivered);

  const share = (rate: number | null): string =>
    rate === null ? "-" : t("adminNewsletter.campaigns.ofDelivered", { percent: rate });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">
          {t("adminNewsletter.campaigns.engagementHeading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AdminMetricTile
            icon={MailOpen}
            label={t("adminNewsletter.campaigns.uniqueOpens")}
            value={uniqueOpens}
            hint={share(openRate)}
          />
          <AdminMetricTile
            icon={MousePointerClick}
            label={t("adminNewsletter.campaigns.uniqueClicks")}
            value={uniqueClicks}
            hint={share(clickRate)}
          />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <dt className="truncate">{t("adminNewsletter.campaigns.opens")}</dt>
            <dd className="m-0 font-medium tabular-nums text-foreground">
              {engagement?.opens ?? 0}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <dt className="truncate">{t("adminNewsletter.campaigns.clicks")}</dt>
            <dd className="m-0 font-medium tabular-nums text-foreground">
              {engagement?.clicks ?? 0}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {t("adminNewsletter.campaigns.engagementHint")}
        </p>
      </CardContent>
    </Card>
  );
}
