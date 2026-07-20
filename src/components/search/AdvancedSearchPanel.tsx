// Tryby zaawansowane wyszukiwarki: dopasowanie (wszystkie słowa / dowolne
// słowo / dokładna fraza), zakres (wszędzie / tylko tytuły) i ściąga składni
// ("fraza", -wykluczenie). Prezentacyjny - stan mieszka w URL, komponent
// emituje łatki Partial<SearchUrl> (undefined czyści klucz, jak reszta paneli).
import { useTranslation } from "react-i18next";
import type { SearchMatchMode, SearchScope } from "@/lib/queries/archives";
import type { SearchUrl } from "@/lib/search/facetModel";

interface Props {
  url: SearchUrl;
  onChange: (patch: Partial<SearchUrl>) => void;
}

const MATCH_MODES: readonly SearchMatchMode[] = ["all", "any", "phrase"] as const;
const SCOPES: readonly SearchScope[] = ["all", "title"] as const;

function Segmented<T extends string>({
  label,
  options,
  value,
  format,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T;
  format: (v: T) => string;
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </p>
      <div
        className="inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5 text-xs"
        role="group"
        aria-label={label}
      >
        {options.map((v) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(v)}
              className={`px-2.5 py-1 rounded-md transition ${
                active
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {format(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdvancedSearchPanel({ url, onChange }: Props) {
  const { t } = useTranslation();
  const match: SearchMatchMode = url.match ?? "all";
  const scope: SearchScope = url.scope ?? "all";

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-4">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <Segmented
          label={t("search.adv.match_label")}
          options={MATCH_MODES}
          value={match}
          format={(v) => t(`search.adv.match.${v}`)}
          onPick={(v) => onChange({ match: v === "all" ? undefined : v })}
        />
        <Segmented
          label={t("search.adv.scope_label")}
          options={SCOPES}
          value={scope}
          format={(v) => t(`search.adv.scope.${v}`)}
          onPick={(v) => onChange({ scope: v === "all" ? undefined : v })}
        />
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          {t("search.adv.syntax_title")}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground font-medium">
              &quot;energia jądrowa&quot;
            </code>
            {t("search.adv.syntax_phrase")}
          </li>
          <li className="flex items-center gap-1.5">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground font-medium">
              -sankcje
            </code>
            {t("search.adv.syntax_exclude")}
          </li>
          <li className="flex items-center gap-1.5">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground font-medium">
              nato bałtyk
            </code>
            {t("search.adv.syntax_and")}
          </li>
          <li className="flex items-center gap-1.5">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground font-medium">
              energia OR klimat
            </code>
            {t("search.adv.syntax_or")}
          </li>
          <li className="flex items-center gap-1.5">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground font-medium">
              NOT sankcje
            </code>
            {t("search.adv.syntax_not")}
          </li>
        </ul>
      </div>
    </div>
  );
}
