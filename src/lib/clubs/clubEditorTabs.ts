// Zakładki EDYTORA KLUBU w panelu i ich odczyt z adresu (`?tab=`) - liść
// wydzielony z `adminClubEditor.ts`.
//
// PO CO OSOBNY PLIK. Trasa `admin.community.clubs.$clubId.tsx` czyta `?tab=`
// w `validateSearch`, a ta opcja - jak `head` i `loader` - należy do
// NIEDZIELONEJ części pliku trasy, czyli jedzie w chunku WEJŚCIOWYM każdej
// strony serwisu. Import z `adminClubEditor` ciągnął tam wersję roboczą
// formularza, payload zapisu i filtry listy klubów - kod panelu w bootcie
// każdego czytelnika (kronika `scripts/check-bundle-size.ts`, wpis XX).
// `adminClubEditor` re-eksportuje wszystko stąd, więc edytor ma jedno źródło
// importu.

/** Zakładki edytora. Kolejność listy = kolejność na pasku. */
export const CLUB_EDITOR_TABS = [
  "general",
  "access",
  "groups",
  "threads",
  "members",
  "invitations",
  "permissions",
  "moderation",
  "analytics",
] as const;

export type ClubEditorTab = (typeof CLUB_EDITOR_TABS)[number];

/**
 * Zakładka z adresu. `?tab=` jest KONTRAKTEM LINKU: administrator, który wysyła
 * komuś odnośnik do zakładki „Uprawnienia", wysyła odnośnik do zakładki
 * „Uprawnienia", a nie do pierwszej zakładki edytora. Wartość nieznana
 * degraduje się do pierwszej zakładki, a nie wywala trasy - stary link
 * z usuniętą zakładką ma otworzyć edytor, nie ekran błędu.
 */
export function clubEditorTab(raw: unknown): ClubEditorTab {
  if (typeof raw !== "string") return "general";
  return (CLUB_EDITOR_TABS as readonly string[]).includes(raw) ? (raw as ClubEditorTab) : "general";
}
