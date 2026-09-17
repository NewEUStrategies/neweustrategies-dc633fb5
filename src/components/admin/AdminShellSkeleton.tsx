// SZKIELET POWŁOKI PANELU - stan "czekamy na rozstrzygnięcie sesji".
//
// PO CO ISTNIEJE. `/admin` jest trasą `ssr: false`, więc dokument przychodzi z
// pustym ciałem, a pierwszy render klienta trafia na `useAuth().loading`.
// Do tej pory malowała się wtedy JEDNA wyśrodkowana kropka w kontenerze
// `min-h-screen flex items-center justify-center`, a po rozstrzygnięciu sesji
// React podmieniał ją na PEŁNĄ powłokę: pasek boczny 14 rem, pasek języka,
// nagłówek sekcji, siatka treści. To nie jest "dokończenie" układu, tylko jego
// całkowita wymiana - i to ona, obok późnego dociągania paneli pulpitu,
// generowała CLS 0,532 na `/admin` (próg "Poor" = 0,250).
//
// KONTRAKT: ten szkielet ma mieć GEOMETRIĘ `AdminShell`, nie jego treść.
// Każda liczba niżej jest przepisana z `AdminShell.tsx` i musi się z nią
// zgadzać, bo to jedyne, co ten plik obiecuje:
//   * korzeń  - `admin-compact min-h-screen bg-muted/30 flex`,
//   * pasek   - `w-56` (albo `w-12`), `bg-card border-r border-border`,
//               `sticky top-0 h-screen`, wewnątrz: blok marki `p-3 border-b`
//               z wierszem `h-9`, pole wyszukiwania `p-2 border-b`, lista
//               pozycji nawigacji,
//   * treść   - `flex-1 min-w-0`.
//
// ŚWIADOMIE BEZ TŁUMACZEŃ I BEZ ZAPYTAŃ: szkielet nie może mieć własnych
// zależności danych ani czekać na słownik - to jest dokładnie ta powierzchnia,
// która ma się pojawić, zanim cokolwiek innego zdąży się rozstrzygnąć. Skutek
// uboczny jest tu zaletą: nie ma w tym pliku ANI JEDNEGO napisu, więc nie ma
// też jednojęzycznego tekstu dla użytkownika (bramka `check:i18n-hardcoded`
// i ratchet `monolingualUserText`).
//
// CAŁY BLOK JEST `aria-hidden` - ta sama doktryna, co w `EventsListSkeleton`:
// szkielet nie niesie żadnej informacji, a kilkanaście pustych prostokątów
// ogłoszonych czytnikowi ekranu to szum, nie komunikat. Napis "Ładowanie..."
// byłby tu napisem UKRYTYM przed czytnikiem (bo blok jest ukryty), czyli
// gorszym niż jego brak.
import { Skeleton } from "@/components/ui/skeleton";

/** Ile pozycji nawigacji rysuje szkielet - tyle, ile mieści pierwszy ekran. */
const NAV_ROWS = 14;

export interface AdminShellSkeletonProps {
  /** Pasek zwinięty (`w-12`) - ta sama decyzja co `compact` w `AdminShell`. */
  compact?: boolean;
  /** Powierzchnie bez paska bocznego (studio wydarzenia, edytory pełnoekranowe). */
  hideSidebar?: boolean;
}

export function AdminShellSkeleton({
  compact = false,
  hideSidebar = false,
}: AdminShellSkeletonProps) {
  return (
    <div
      data-admin-shell-skeleton=""
      aria-hidden="true"
      className={`admin-compact min-h-screen bg-muted/30 ${hideSidebar ? "" : "flex"}`}
    >
      {hideSidebar ? null : (
        <aside
          className={`${compact ? "w-12" : "w-56"} bg-card border-r border-border flex flex-col sticky top-0 self-start h-screen max-h-screen sidebar-shell`}
        >
          {/* Blok marki - `p-3 border-b` + wiersz o wysokości `h-9`. */}
          <div className="p-3 border-b border-border">
            <div className={`flex items-center ${compact ? "justify-center" : "gap-2"}`}>
              <Skeleton className={compact ? "h-8 w-8 rounded" : "h-9 flex-1"} />
            </div>
          </div>
          {/* Pole wyszukiwania panelu - rysowane tylko w wariancie rozwiniętym,
              dokładnie jak w `AdminShell`. */}
          {compact ? null : (
            <div className="p-2 border-b border-border">
              <Skeleton className="h-7 w-full" />
            </div>
          )}
          <div className="flex-1 overflow-hidden p-2 space-y-1.5">
            {Array.from({ length: NAV_ROWS }, (_, index) => (
              <Skeleton
                key={index}
                className={compact ? "h-5 w-6 mx-auto" : "h-5 w-full"}
                style={compact ? undefined : { opacity: 1 - index * 0.04 }}
              />
            ))}
          </div>
        </aside>
      )}
      <main className="flex-1 min-w-0">
        <div className="p-4 md:p-6 space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-3.5 w-96 max-w-full" />
          </div>
          <Skeleton className="h-7 w-72 max-w-full" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      </main>
    </div>
  );
}
