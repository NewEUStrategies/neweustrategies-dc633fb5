/**
 * Czy plik pasuje do atrybutu `accept` - regułą, którą stosuje przeglądarka.
 *
 * PO CO TO ISTNIEJE. `accept` filtruje WYŁĄCZNIE okno systemowe wyboru pliku.
 * `DataTransfer.files` z upuszczenia przechodzi przez niego jak przez
 * powietrze - przeglądarka nie odrzuca niczego, co użytkownik upuści. Zanim
 * obszary wgrywania stały się wspólne, większość pól przyjmowała tylko
 * kliknięcie, więc luka nie miała gdzie się objawić; ujednolicenie dało
 * WSZYSTKIM polom upuszczanie naraz i dlatego filtr musi stać w jednym
 * miejscu, po stronie klienta, PRZED wysyłką bajtów.
 *
 * Reguła dopasowania (ta sama, co w HTML):
 *   - pozycja zaczynająca się kropką to ROZSZERZENIE (`.woff2`, `.csv`),
 *   - pozycja z gwiazdką to RODZINA typów (`image/*`),
 *   - pozostałe to pełny typ MIME (`application/pdf`).
 * Pusty albo nieobecny `accept` przepuszcza wszystko - tak jak brak atrybutu.
 *
 * CZEGO TA FUNKCJA NIE ZASTĘPUJE: serwerowej allowlisty z
 * `src/lib/media/upload.ts` ani `allowed_mime_types` bucketu. To jest pierwsza
 * bramka (żeby użytkownik dostał odmowę, zanim poleci pierwszy bajt), a nie
 * jedyna.
 */
export function matchesAccept(file: File, accept: string | undefined): boolean {
  const patterns = (accept ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  if (patterns.length === 0) return true;

  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith(".")) return name.endsWith(pattern);
    if (pattern.endsWith("/*")) {
      const family = pattern.slice(0, -1); // "image/*" -> "image/"
      return mime.startsWith(family);
    }
    // Plik BEZ typu (część systemów oddaje pusty `type`) nie może „pasować"
    // do konkretnego MIME - inaczej pusty typ byłby uniwersalnym kluczem.
    return mime !== "" && mime === pattern;
  });
}
