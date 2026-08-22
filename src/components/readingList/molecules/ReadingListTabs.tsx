// Pasek zakładek listy czytelniczej.
//
// MOLEKUŁA: czysta prezentacja deskryptorów z `atoms/readingListTabs` -
// nie wie, skąd biorą się zakładki, ani co się stanie po zmianie.
//
// Etykieta zakładki to tekst REDAKCYJNY z ustawień personalizacji (nagłówek
// sekcji wpisany w panelu), więc nie przechodzi przez i18n - patrz atom.
import type {
  ReadingListTab,
  ReadingListTabDescriptor,
} from "@/components/readingList/atoms/readingListTabs";

export function ReadingListTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly ReadingListTabDescriptor[];
  active: ReadingListTab;
  onSelect: (tab: ReadingListTab) => void;
}) {
  return (
    <div className="flex justify-center gap-1 mb-8 border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
            active === tab.id
              ? "border-brand text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
