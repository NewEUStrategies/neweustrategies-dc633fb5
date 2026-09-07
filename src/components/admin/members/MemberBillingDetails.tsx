// Molekuła: rozwinięcie wiersza członka - płatności i historia nadań.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { getMemberBilling } from "@/lib/admin/membersDirectory.functions";
import { uiLocale } from "@/lib/i18n/format";

interface Props {
  userId: string;
}

function money(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function MemberBillingDetails({ userId }: Props) {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);
  const billingFn = useServerFn(getMemberBilling);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-member-billing", userId],
    queryFn: () => billingFn({ data: { userId } }),
  });

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">{t("adminMembers.table.loading")}</p>;
  }

  return (
    <div className="grid gap-6 rounded-[6px] bg-muted/40 p-4 md:grid-cols-2">
      <section>
        <h4 className="mb-2 text-sm font-semibold">{t("adminMembers.details.payments")}</h4>
        {data && data.payments.length > 0 ? (
          <ul className="space-y-2">
            {data.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {new Date(payment.date).toLocaleDateString(locale)} · {payment.status}
                </span>
                <span className="flex items-center gap-2 font-medium">
                  {money(payment.amountCents, payment.currency, locale)}
                  {payment.invoiceUrl ? (
                    <a
                      className="text-primary underline"
                      href={payment.invoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("adminMembers.details.invoice")}
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("adminMembers.details.noPayments")}</p>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold">{t("adminMembers.details.grants")}</h4>
        {data && data.grants.length > 0 ? (
          <ul className="space-y-2">
            {data.grants.map((grant) => (
              <li key={grant.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{grant.tierKey}</span>
                <span className="text-muted-foreground">
                  {grant.revokedAt
                    ? t("adminMembers.details.revoked")
                    : grant.expiresAt
                      ? t("adminMembers.details.until", {
                          date: new Date(grant.expiresAt).toLocaleDateString(locale),
                        })
                      : t("adminMembers.details.forever")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("adminMembers.details.noGrants")}</p>
        )}
      </section>
    </div>
  );
}
