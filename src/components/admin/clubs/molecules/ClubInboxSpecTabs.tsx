// Molekuła: pas zakładek skrzynki - specjalizacje z licznikiem zaległości.
//
// CO BYŁO W ORGANIZMIE. Pas `role="tablist"` wpisany wprost w
// `ClubApplicationsInbox`, razem z budową listy zakładek i wyborem języka nazw.
// Sama LISTA jest teraz regułą (`applicationSpecTabs`), bo decyduje o dwóch
// rzeczach o widocznych skutkach: że pierwsza zakładka to zawsze „wszystkie”
// (brak filtra jest osobnym, najczęstszym widokiem, a nie brakiem wyboru)
// i że specjalizacja bez wpisu w licznikach ma ZERO, nie `undefined`.
//
// DLACZEGO LICZNIK POKAZUJE SIĘ TYLKO PRZY ZALEGŁOŚCI. Zero przy każdej
// z ośmiu zakładek to osiem cyfr do przeczytania po to, żeby dowiedzieć się,
// że nie ma nic do zrobienia. Widoczna liczba znaczy więc „tu czeka decyzja”
// i tylko to.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać zakładki i oddać wybór. Molekuła nie liczy
// zaległości i nie pyta bazy o specjalizacje.
import type { InboxTab } from "@/lib/clubs/adminApplicationsInbox";

export function ClubInboxSpecTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly InboxTab[];
  /** Wybrana specjalizacja; `""` = zakładka „wszystkie”. */
  active: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <div className="tabs-scroller flex gap-2 overflow-x-auto pb-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.slug === "" ? "all" : tab.slug}
          type="button"
          role="tab"
          aria-selected={active === tab.slug}
          onClick={() => onSelect(tab.slug)}
          className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
            active === tab.slug
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
          {tab.pending > 0 ? (
            <span className="ml-2 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
              {tab.pending}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
