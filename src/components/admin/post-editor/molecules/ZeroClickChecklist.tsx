// Molekuła: stan JEDNEJ wersji językowej wpisu względem reguł zero-click.
// Wiersze są zawsze w komplecie i zawsze w tej samej kolejności - redaktor ma
// się nauczyć kolejności pracy (lead → nagłówki → FAQ → punkty → lista), a nie
// czytać listę, która zmienia długość przy każdym zapisie.
import { useTranslation } from "react-i18next";
import { Check, AlertTriangle, Circle } from "lucide-react";
import type { ZeroClickReport, ZeroClickStatus } from "@/lib/seo/zeroClick";
import { zeroClickMessage, zeroClickRuleTitleKey } from "../lib/zeroClickMessages";
// Nakładka rejestruje klucze `adminZeroClick.*` efektem ubocznym importu -
// bez tej linijki wiersz checklisty pokazałby surowy klucz, gdy chunk edytora
// przestanie przypadkiem wciągać słownik innym modułem.
import "@/lib/i18n-admin-zero-click";

const STATUS_STYLE: Record<ZeroClickStatus, { icon: typeof Check; className: string }> = {
  ok: { icon: Check, className: "text-emerald-600 dark:text-emerald-400" },
  warn: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  todo: { icon: Circle, className: "text-muted-foreground" },
};

export function ZeroClickChecklist({
  report,
  label,
}: {
  report: ZeroClickReport;
  /** Nazwa wersji językowej (nagłówek kolumny). */
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h4>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {t("adminZeroClick.checklist.score", {
            passed: report.passed,
            total: report.total,
          })}
        </span>
      </div>
      <ul className="space-y-1.5">
        {report.checks.map((check) => {
          const { icon: Icon, className } = STATUS_STYLE[check.status];
          const message = zeroClickMessage(check);
          const statusLabel = t(
            check.status === "ok"
              ? "adminZeroClick.checklist.statusOk"
              : check.status === "warn"
                ? "adminZeroClick.checklist.statusWarn"
                : "adminZeroClick.checklist.statusTodo",
          );
          return (
            <li key={check.id} className="flex items-start gap-2 text-xs leading-snug">
              {/* Sam kolor ikony nie niesie statusu dla czytnika ekranu ani dla
                  osoby nierozróżniającej barw - stąd tekstowa etykieta w SR. */}
              <span className={`mt-0.5 shrink-0 ${className}`} aria-hidden="true">
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="sr-only">{`${statusLabel}: `}</span>
              <span className="min-w-0">
                <span className="font-medium">{t(zeroClickRuleTitleKey(check.id))}</span>
                <span className="text-muted-foreground"> - {t(message.key, message.params)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
