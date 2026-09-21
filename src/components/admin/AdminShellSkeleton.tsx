// SZKIELET POWŁOKI PANELU - stan "czekamy na rozstrzygnięcie sesji".
//
// PO CO ISTNIEJE. Panel rozstrzyga sesję (token Supabase w `localStorage`)
// dopiero po hydratacji, więc pierwszy render trafia na `useAuth().loading`.
// Do tej pory malowała się wtedy JEDNA wyśrodkowana kropka w kontenerze
// `min-h-screen flex items-center justify-center`, a po rozstrzygnięciu sesji
// React podmieniał ją na PEŁNĄ powłokę: pasek boczny 14 rem, pasek języka,
// nagłówek sekcji, siatka treści. To nie jest "dokończenie" układu, tylko jego
// całkowita wymiana - i to ona, obok późnego dociągania paneli pulpitu,
// generowała CLS 0,532 na `/admin` (próg "Poor" = 0,250).
//
// OD AUDYTU CWV 2026-09-20 (F32 / plan 3.13) TEN KOMPONENT WYCHODZI Z SERWERA.
// `routes/admin.tsx` nie deklaruje już `ssr: false`: serwer renderuje WYŁĄCZNIE
// ten szkielet, a wszystko zależne od sesji montuje się za bramką
// `useHydrated()`. Konsekwencja dla tego pliku jest twarda: NIE WOLNO MU
// ODCZYTAĆ `window`, `localStorage` ani zegara - każda taka wartość jest czymś,
// czego serwer nie zna, czyli rozjazdem hydratacji (dowód:
// `src/routes/__tests__/adminRouteSsr.test.tsx`).
//
// KONTRAKT: ten szkielet ma mieć GEOMETRIĘ `AdminShell`, nie jego treść. Od
// 2026-09-21 nie jest to już przepisana z pamięci lista klas, tylko IMPORT
// z `adminShellGeometry.ts` - tego samego modułu, z którego bierze klasy
// powłoka. Powód jest zmierzony: dopóki obie strony deklarowały te same klasy
// osobno, parytet trzymał się dopóty, dopóki ktoś nie zmienił jednej z nich
// (a przy `style-4` nie trzymał się nawet wtedy, bo o szerokości tego paska
// decyduje arkusz przez `data-sidebar-style`, a nie klasa Tailwinda).
//
// WARIANT PASKA JEST WEJŚCIEM, NIE ZGADYWANIEM. Szkielet dostaje `sidebarStyle`
// od trasy - ta czyta go z mapy `site_settings` ROZGRZANEJ PRZEZ LOADER
// KORZENIA, czyli z wartości, którą serwer zna i którą klient dostaje
// zdehydratowaną razem z dokumentem. `null` znaczy „nie wiadomo" i wtedy pasek
// zostaje przy geometrii domyślnej - nigdy przy cudzej.
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
import { isCompactSidebarRoute } from "@/lib/admin/adminNav";
import type { SidebarStyle } from "@/lib/builder/sidebarStyles";
import {
  ADMIN_SIDEBAR_BRAND_BOX_CLASS,
  ADMIN_SIDEBAR_FRAME_CLASS,
  ADMIN_SIDEBAR_SEARCH_BOX_CLASS,
  ADMIN_SIDEBAR_SEARCH_FIELD_CLASS,
  adminContentColumnClass,
  adminContentPaddingClass,
  adminShellRootClass,
  adminSidebarBrandRowClass,
  adminSidebarWidthClass,
  isAdminSidebarCompact,
  isAdminThemeOptionsRoute,
} from "@/components/admin/adminShellGeometry";

/** Ile pozycji nawigacji rysuje szkielet - tyle, ile mieści pierwszy ekran. */
const NAV_ROWS = 14;

export interface AdminShellSkeletonProps {
  /**
   * Ścieżka panelu - jedyne wejście, które serwer zna ZAWSZE. Decyduje o tym
   * samym, o czym decyduje w powłoce: o zwinięciu paska na edytorach i o
   * paddingu kolumny treści.
   */
  path?: string;
  /**
   * Wariant paska z ustawień najemcy, gdy jest już znany (loader korzenia
   * rozgrzewa `site_settings` także na `/admin`). `null`/brak = nie wiadomo.
   */
  sidebarStyle?: SidebarStyle | null;
  /** Powierzchnie bez paska bocznego (studio wydarzenia, edytory pełnoekranowe). */
  hideSidebar?: boolean;
}

export function AdminShellSkeleton({
  path = "/admin",
  sidebarStyle = null,
  hideSidebar = false,
}: AdminShellSkeletonProps) {
  const isEditRoute = isCompactSidebarRoute(path);
  const compact = isAdminSidebarCompact({ isEditRoute, style: sidebarStyle });
  return (
    <div
      data-admin-shell-skeleton=""
      aria-hidden="true"
      className={adminShellRootClass(hideSidebar)}
    >
      {hideSidebar ? null : (
        <aside
          // ATRYBUTY ARKUSZA SĄ TU GEOMETRIĄ, NIE DEKORACJĄ: `styles.css` nadaje
          // `style-4` twarde `width: 3.5rem !important`, a `style-3` margines
          // 0,75 rem. Bez tej pary selektor nie trafia i szkielet maluje inny
          // prostokąt niż powłoka, która po nim nastąpi - nawet przy tej samej
          // klasie szerokości.
          data-sidebar="sidebar"
          data-sidebar-style={sidebarStyle ?? undefined}
          className={`${adminSidebarWidthClass(compact)} ${ADMIN_SIDEBAR_FRAME_CLASS}`}
        >
          {/* Blok marki - `p-3 border-b` + wiersz o przypiętej wysokości. */}
          <div className={ADMIN_SIDEBAR_BRAND_BOX_CLASS}>
            <div className={`flex items-center ${compact ? "justify-center" : "gap-2"}`}>
              <Skeleton
                className={`${adminSidebarBrandRowClass(compact)}${compact ? " rounded" : ""}`}
              />
            </div>
          </div>
          {/* Pole wyszukiwania panelu - rysowane tylko w wariancie rozwiniętym,
              dokładnie jak w `AdminShell`. */}
          {compact ? null : (
            <div className={ADMIN_SIDEBAR_SEARCH_BOX_CLASS}>
              <Skeleton className={`${ADMIN_SIDEBAR_SEARCH_FIELD_CLASS} w-full`} />
            </div>
          )}
          <div className="flex-1 overflow-hidden p-2 space-y-1.5">
            {Array.from({ length: NAV_ROWS }, (_, index) => (
              <Skeleton key={index} className={compact ? "h-5 w-6 mx-auto" : "h-5 w-full"} />
            ))}
          </div>
        </aside>
      )}
      {/* TREŚĆ: rama i jeden ekran wysokości - NIC WIĘCEJ, i to jest decyzja.
          Ten szkielet stoi na KAŻDEJ trasie `/admin/**`, a ekrany panelu nie
          mają wspólnego układu wewnętrznego: pulpit ma kafle i wykresy, lista
          wpisów - tabelę, edytor - dwie kolumny. Rysowanie tu siatki kafli
          byłoby zgadywaniem, które na większości tras jest błędne, czyli
          dokładałoby przesunięcie zamiast je zdejmować. Wspólny jest za to
          PADDING kolumny - i on idzie z tego samego modułu co w powłoce. */}
      <main className={adminContentColumnClass({ hideSidebar, isEditRoute })}>
        <div
          className={`${adminContentPaddingClass({ isEditRoute, isThemeOptions: isAdminThemeOptionsRoute(path) })} space-y-4`}
        >
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-[70vh] w-full" />
        </div>
      </main>
    </div>
  );
}
