# Plan: nowy publiczny layout programu, debat i osób wydarzenia

## Cel
Zbudować wybrany kierunek publicznej agendy wydarzenia jako spójny widok dni, ścieżek, debat, prelegentów i moderatorów oraz uzupełnić panel administracyjny o brakujące pola potrzebne do wprowadzania tych danych.

## Zakres wdrożenia
1. Przebuduję publiczny widok programu wydarzenia:
   - dni jako wyraźne segmenty programu,
   - ścieżki jako filtry i kontekst merytoryczny,
   - debaty/sesje jako rozwijane bloki z czasem, miejscem, opisem, ścieżką, sponsorem i obsadą,
   - responsywny układ desktop/mobile zgodny z obecnym stylem serwisu.

2. Przebuduję prezentację prelegentów i moderatorów:
   - rozróżnienie ról w agendzie,
   - bardziej redakcyjne karty osób,
   - dopracowany dialog profilu publicznego,
   - widoczność informacji wpisanych w panelu, bez placeholderów.

3. Uzupełnię backend i panel administracyjny:
   - dodam opcjonalne przypięcie sponsora do ścieżki,
   - dodam opcjonalne przypięcie sponsora do debaty/sesji,
   - dodam dwujęzyczne pole przynależności/afiliacji debaty, jeśli nie wystarcza sama ścieżka,
   - rozszerzę RPC admin/public tak, aby nowe pola były dostępne w panelu i publicznej agendzie,
   - zachowam tenant isolation i istniejące uprawnienia.

4. Uzupełnię tłumaczenia i testy:
   - PL/EN bez `defaultValue`,
   - testy parserów i komponentów publicznego widoku,
   - testy lub aktualizacje dla formularzy admina, gdzie zmieni się kontrakt pól.

## Szczegóły techniczne
- Zmiany bazy będą addytywne: nowe kolumny i zaktualizowane funkcje, bez kasowania istniejących danych.
- Relacje sponsorów będą tenant-scoped przez composite foreign keys do `event_sponsors`.
- Publiczne RPC `event_agenda` zwróci dane sponsora i afiliacji tylko dla opublikowanych/publicznych rekordów.
- Admin RPC `admin_event_session_save`, `admin_event_session_detail`, `admin_event_sessions_list`, `admin_event_track_save` i `admin_event_tracks_list` zostaną rozszerzone o nowe pola.
- Front rozszerzy `agendaSurface.ts`, `sessionsApi.ts`, formularze sesji/ścieżek i komponenty publiczne.
- Nie będę ruszać innych obszarów aplikacji, zależności, progów bundle ani niezwiązanych findingów security.

## Weryfikacja
- Sprawdzę istnienie nowych tabel/kolumn/RPC w Supabase.
- Uruchomię dostępne testy dla zmienionych modułów, typecheck i format/lint zgodnie z możliwościami środowiska.
- Zweryfikuję render publicznego preview w Lovable po wdrożeniu zmian.
