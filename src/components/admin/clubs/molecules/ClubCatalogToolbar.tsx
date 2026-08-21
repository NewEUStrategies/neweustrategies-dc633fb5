// Molekuła: NAGŁÓWEK katalogu taksonomii - tytuł, zdanie wprowadzające,
// przycisk dodania i licznik włączonych wpisów.
//
// CO BYŁO W ORGANIZMACH. Ten sam blok stał DWA RAZY, w dwóch plikach:
// `ClubTopicsManager` i `ClubSpecializationsManager` miały po własnej kopii
// tej samej siatki (`flex-wrap`, `justify-between`, przycisk z ikoną plusa)
// i po własnym akapicie z licznikiem pod nią. Dwie kopie znaczą dwa miejsca
// do poprawienia, gdy przycisk zaczyna się zawijać na telefonie - i jedno
// z nich zawsze zostaje niepoprawione.
//
// LICZNIK JEST CZĘŚCIĄ NAGŁÓWKA, NIE LISTY. Zdanie „aktywne: 4 z 9” mówi
// o katalogu, a nie o wierszu, więc stoi nad listą i zostaje na ekranie także
// wtedy, gdy lista jest w locie albo pusta.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać, czym jest ten katalog, i oddać zdarzenie
// „dodaj wpis”. Molekuła nie zna słownika (dostaje gotowe napisy, bo klucze
// obu katalogów mieszkają w RÓŻNYCH plikach i18n), nie czyta danych serwera
// i nie wie, co się otworzy po kliknięciu.
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ClubCatalogToolbar({
  title,
  subtitle,
  addLabel,
  onAdd,
  summary,
}: {
  title: string;
  subtitle: string;
  addLabel: string;
  onAdd: () => void;
  /** Zdanie o stanie katalogu (aktywne z całości) - gotowy napis, nie liczby. */
  summary: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus className="mr-1.5 h-4 w-4" />
          {addLabel}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{summary}</p>
    </>
  );
}
