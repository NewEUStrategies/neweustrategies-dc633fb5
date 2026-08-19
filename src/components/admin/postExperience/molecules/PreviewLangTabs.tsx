import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PreviewLangTabsProps {
  value: "pl" | "en";
  onChange: (lang: "pl" | "en") => void;
  /** Dostępna nazwa grupy zakładek - „język podglądu". */
  label: string;
}

/**
 * Molekuła: przełącznik języka podglądu (PL / EN).
 *
 * CO SCALIŁA. Dwie kopie w panelach ToC i sekcji „dowiesz się", różniące się
 * tylko obecnością emoji flagi. Flagi zostały usunięte świadomie: flaga
 * państwa nie jest nazwą języka (czytnik ekranu ogłaszał „flaga Polski PL"),
 * a lista zakładek dostała nazwę grupy, której obie kopie nie miały.
 *
 * Normalizacja wartości siedzi tutaj, bo Radix oddaje `string`: cokolwiek
 * innego niż `en` schodzi do `pl`, więc stan podglądu nigdy nie wychodzi poza
 * dwa dozwolone języki.
 */
export function PreviewLangTabs({ value, onChange, label }: PreviewLangTabsProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next === "en" ? "en" : "pl")}>
      <TabsList aria-label={label}>
        <TabsTrigger value="pl">PL</TabsTrigger>
        <TabsTrigger value="en">EN</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
