// Organizm: LISTA ostatnich wplat. Wyniesione z
// `src/routes/admin.donations.tsx` bez zmiany zachowania: komponent jest
// prezentacyjny, zapytanie zostaje na stronie.
import { useTranslation } from "react-i18next";
import { formatDonationAmount } from "@/lib/billing/donationsConfig";
import type { AdminDonationRow } from "@/lib/billing/donationsAdmin.server";

interface DonationsRecordsPanelProps {
  /** Wiersze rejestru; `undefined` dopoki zapytanie nie wroci. */
  records: AdminDonationRow[] | undefined;
  isPending: boolean;
  lang: "pl" | "en";
}

export function DonationsRecordsPanel({ records, isPending, lang }: DonationsRecordsPanelProps) {
  // Wszystkie napisy ida przez `lng: lang` - tym samym jezykiem, ktorym
  // formatujemy DATE i KWOTE w wierszu. Bez tego tabela mowi dwoma jezykami
  // naraz, a „miesięczna" jest jedynym sygnalem, ze wplata jest cykliczna.
  const { t } = useTranslation();
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-sm font-semibold">
        {t("donate.admin.records.title", { lng: lang })}
      </h3>
      {isPending ? (
        <p className="text-sm text-muted-foreground">{t("admin.loading", { lng: lang })}</p>
      ) : (records?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("donate.admin.records.empty", { lng: lang })}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("donate.admin.records.date", { lng: lang })}</th>
                <th className="px-3 py-2">{t("donate.admin.records.amount", { lng: lang })}</th>
                <th className="px-3 py-2">{t("donate.admin.records.status", { lng: lang })}</th>
                <th className="px-3 py-2">{t("donate.admin.records.type", { lng: lang })}</th>
                <th className="px-3 py-2">{t("donate.admin.records.donor", { lng: lang })}</th>
              </tr>
            </thead>
            <tbody>
              {records?.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">
                    {new Date(row.createdAt).toLocaleString(lang === "en" ? "en-GB" : "pl-PL")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDonationAmount(row.amountCents, row.currency, lang)}
                  </td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">
                    {row.recurring
                      ? t("donate.admin.records.recurring", { lng: lang })
                      : t("donate.admin.records.oneTime", { lng: lang })}
                  </td>
                  <td className="px-3 py-2">{row.donorEmail ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
