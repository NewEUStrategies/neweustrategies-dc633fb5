// Molekuła: przełącznik środowiska rejestru.
import { useTranslation } from "react-i18next";
import { ENVIRONMENT_FILTERS, type EnvironmentFilter } from "@/lib/admin/monetization/model";

export function EnvironmentFilterTabs({
  value,
  onChange,
}: {
  value: EnvironmentFilter;
  onChange: (next: EnvironmentFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("adminMonetization.environment.label")}
      </span>
      <div
        role="tablist"
        aria-label={t("adminMonetization.environment.label")}
        className="inline-flex rounded-[6px] border border-border p-0.5"
      >
        {ENVIRONMENT_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={value === option}
            onClick={() => onChange(option)}
            className={`h-8 rounded-[6px] px-3 text-sm font-medium transition-colors ${
              value === option
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`adminMonetization.environment.${option}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
