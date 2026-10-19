// Organizm: panel kampanii KUPONOWEJ w edytorze kampanii newslettera (P04, R-25).
//
// PO CO. Kampania newslettera podpięta pod kampanię kuponową wysyła każdemu
// odbiorcy WŁASNY kod. Dwie rzeczy muszą być widoczne ZANIM ktoś kliknie
// „Wyślij": do kogo pójdą kody (lista mailingowa albo cała lista) i czy kodów
// starczy dla wszystkich odbiorców. Wcześniej edytor nie mówił ani jednego,
// a kampania „do segmentu" szła do całej listy (R-25). Panel pokazuje nazwę
// kampanii kuponowej (z linkiem), segment, liczbę odbiorców liczoną tym samym
// predykatem co wysyłka i liczbę wolnych kodów; `couponSendBlock` mówi
// trasie, kiedy wysyłkę zablokować. Serwer i tak zatrzyma wysyłkę
// (`COUPON_CODES_INSUFFICIENT`) - panel nie pozwala do tego dojść.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgePercent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { couponSendBlock, type NewsletterCouponInfo } from "../couponSendBlock";
import { mailingListLabel } from "../mailingLists";

const STATUS_KEYS: Record<string, string> = {
  draft: "adminCoupons.campaignStatus.draft",
  generated: "adminCoupons.campaignStatus.generated",
  sent: "adminCoupons.campaignStatus.sent",
  archived: "adminCoupons.campaignStatus.archived",
};

export function NewsletterCouponPanel({
  coupon,
  segment,
  recipients,
  sentCount,
}: {
  coupon: NewsletterCouponInfo;
  /** `audience_filter.segment` kampanii newslettera (brak = cała lista). */
  segment: string | undefined;
  /** Liczba odbiorców z `countCampaignAudience`; `undefined` = w trakcie liczenia. */
  recipients: number | undefined;
  /** `sent_count` kampanii newslettera (wznowienie nie jest blokowane kodami). */
  sentCount: number;
}) {
  ensureAdminCouponsI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const settings = useNewsletterSettings();
  const lists = settings.data?.popup_mailing_lists;
  const block = couponSendBlock({ coupon, recipients, sentCount });

  const segmentLabel = segment
    ? (mailingListLabel(segment, lists, lang) ??
      t("adminCoupons.segmentField.unknown", { id: segment }))
    : t("adminCoupons.segmentField.wholeList");
  // Segment spoza list = wysyłka go odrzuci (fail-closed) - ekran ma to
  // pokazać, zanim operator kliknie. Dopóki ustawienia się wczytują, nie
  // ogłaszamy „nieznanej listy" na zapas.
  const segmentUnknown =
    Boolean(segment) && settings.data !== undefined && !mailingListLabel(segment!, lists, lang);

  return (
    <Card data-testid="panel-kampanii-kuponowej">
      <CardHeader>
        <CardTitle className="text-base">
          <BadgePercent className="w-4 h-4 inline mr-2" aria-hidden="true" />
          {t("adminCoupons.newsletterCampaign.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("adminCoupons.newsletterCampaign.intro")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/coupons/campaigns"
            search={{ id: coupon.couponCampaignId }}
            className="font-medium hover:underline"
            aria-label={`${t("adminCoupons.newsletterCampaign.openCoupon")}: ${coupon.name}`}
          >
            {coupon.name}
          </Link>
          <Badge variant="outline">
            {STATUS_KEYS[coupon.status] ? t(STATUS_KEYS[coupon.status]!) : coupon.status}
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">
              {t("adminCoupons.newsletterCampaign.segment")}
            </dt>
            <dd className={segmentUnknown ? "font-medium text-destructive" : "font-medium"}>
              {segmentLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("adminCoupons.newsletterCampaign.recipients")}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">{recipients ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("adminCoupons.newsletterCampaign.codesFree")}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {t("adminCoupons.newsletterCampaign.codesOf", {
                free: coupon.codesAvailable,
                total: coupon.codesTotal,
              })}
            </dd>
          </div>
        </dl>
        {block === "short" && (
          <div
            role="alert"
            className="rounded-[6px] border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          >
            {t("adminCoupons.newsletterCampaign.codesShort", {
              available: coupon.codesAvailable,
              recipients,
            })}
          </div>
        )}
        {block === "counting" && (
          <p className="text-xs text-muted-foreground" role="status">
            {t("adminCoupons.newsletterCampaign.counting")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
