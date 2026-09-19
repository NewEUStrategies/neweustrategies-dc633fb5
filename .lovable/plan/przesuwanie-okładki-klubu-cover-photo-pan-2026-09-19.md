# Przesuwanie okładki klubu (cover photo pan)

## Cel
Umożliwić prowadzeniu klubu przesunięcie pionowe cover photo, żeby wybrać najlepszy fragment obrazu w ramce 4:1 / max-h-56.

## Zakres
1. **Baza danych**
   - Dodać kolumnę `cover_position_y` (smallint, 0–100, default 50) do `public.clubs`.
   - Zaktualizować widoki i funkcje RPC (`club_set_cover`, widoki klubów), żeby przenosiły i przywracały pole.
   - Migracja SQL z GRANT/RLS.

2. **Typy**
   - Wygenerować świeże `src/integrations/supabase/types.ts` (lub dodać pole ręcznie, jeśli generator nie jest dostępny).
   - Rozszerzyć `ClubViewRow` i typy payloadów o `cover_position_y`.

3. **Backend**
   - Nowa server function `setClubCoverPosition` (`src/lib/clubs/coverApi.functions.ts`) wywołująca `club_set_cover_position` RPC.
   - Funkcja SQL `club_set_cover_position(p_club_id uuid, p_position_y smallint)` z walidacją zakresu 0–100 i uprawnień `can_moderate`.

4. **UI**
   - W `ClubCoverEditor` dodać modal/slider pozwalający ustawić pozycję pionową (0% = góra, 100% = dół).
   - Podgląd na żywo w modalu z realnym coverem w ramce 4:1.
   - Zapisywanie przez `setClubCoverPosition`.
   - W `ClubHubIdentity` zastosować `object-position: center <position>%` na `<img>` okładki.

5. **i18n**
   - Klucze PL/EN w panelu klubu: tytuł modalu, etykiety suwaka, toast.

6. **Testy**
   - Test jednostkowy walidacji pozycji.
   - Test renderowania `ClubHubIdentity` z różnymi wartościami `cover_position_y`.

## Wykluczenia
- Nie dodajemy crop/kadrowania poziomego ani zoomu — tylko przesunięcie pionowe.
- Nie zmieniamy polityki storage ani uploadu pliku.
- Nie dotykamy okładek postów/stron.

## Akceptacja
- Prowadzący klub widzi przycisk „Dostosuj okładkę" obok „Zmień okładkę".
- Suwak pozwala wybrać fragment covera; podgląd odzwierciedla efekt.
- Po zapisie strona klubu pokazuje okładkę z wybranym `object-position`.
- Wartość persists po odświeżeniu.
