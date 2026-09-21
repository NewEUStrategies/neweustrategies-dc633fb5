# Dolny pasek jako centrum narzędzi (jak na zrzutach)

Dolny pasek przestaje być tylko nawigacją. Obok obecnych pozycji (Sieć kontaktów, Czaty, Start, Kluby, Profil) dochodzi rząd narzędzi, które otwierają wysuwane panele nad paskiem - dokładnie tak, jak na załączonych zrzutach.

## Co dostanie użytkownik

1. **Czat** - panel z listą rozmów, sekcjami zwijanymi (Online, Wiadomości prywatne, Kanały i grupy, Notatki własne), wyszukiwarką osób i wejściem w rozmowę bez opuszczania strony.
2. **Zadania (to-do)** - szybkie dodawanie zadania, priorytety (Pilne / Wysoki / Średni / Niski), odhaczanie, zakładki: osobiste TO-DO oraz zadania i projekty, które już są w systemie.
3. **Notatki / notatnik** - tytuł, treść, kolor karteczki, edycja i usuwanie.
4. **Zapisane elementy** - to, co użytkownik zapisał w serwisie (artykuły, strony, wydarzenia), z filtrem i wejściem w materiał.
5. **Kalendarz** - miesięczny widok z zaznaczonymi dniami, lista wydarzeń i spotkań danego dnia, przejście do pełnego kalendarza.
6. **Do przeczytania później** - kolejka materiałów z filtrami Nieprzeczytane / Wszystko / Archiwum, sortowaniem i wyszukiwarką, oznaczaniem jako przeczytane.

Wszystko po polsku i angielsku, z licznikami przy ikonach (nieprzeczytane wiadomości, otwarte zadania, materiały w kolejce).

## Zachowanie i wygląd

- Pasek zachowuje obecny animowany garb i konfigurację z panelu administratora; narzędzia to nowa, osobna grupa ikon obok pozycji nawigacyjnych.
- Panel otwiera się nad paskiem: na telefonie pełna szerokość z uchwytem do przeciągnięcia, na większych ekranach dokowane okno w rogu (jak na zrzutach).
- Jeden panel na raz, zamykanie gestem, klawiszem Escape i przyciskiem; stan ostatnio otwartego narzędzia zapamiętany lokalnie.
- Dostępność: focus trap, etykiety ARIA, obsługa klawiatury, brak blokady przewijania strony pod panelem.
- Panele widoczne tylko dla zalogowanych; gość widzi zachętę do logowania.

## Zakres techniczny

**Baza (nowe, izolowane per tenant i użytkownik):**
- `user_notes` - tytuł, treść, kolor, przypięcie, znaczniki czasu.
- `user_todos` - treść, priorytet, termin, status wykonania, źródło (własne / powiązane z zadaniem systemowym).
- `user_read_later` - kolejka materiałów: typ i identyfikator encji, stan (nieprzeczytane / przeczytane / archiwum), data dodania.
- Dla każdej tabeli: GRANT dla `authenticated` i `service_role`, RLS zawężone do `auth.uid()` + tenant, indeksy pod listy i liczniki.

**Kod:**
- `src/lib/dock/` - typy, klucze zapytań, funkcje serwerowe (`*.functions.ts`) i zapytania klienta dla notatek, zadań, kolejki czytania i kalendarza.
- `src/components/dock/` w atomic design: atomy (chip priorytetu, pusty stan, uchwyt panelu), molekuły (wiersz notatki, wiersz zadania, kafel materiału, siatka miesiąca), organizmy (`ChatPanel`, `TodoPanel`, `NotesPanel`, `SavedPanel`, `CalendarPanel`, `ReadLaterPanel`) i szablon `DockPanelShell`.
- `MobileBottomBarView` rozszerzony o grupę narzędzi i sterowanie panelami; obecne pozycje nawigacyjne bez zmian w wyglądzie.
- Panele czatu i zapisanych korzystają z istniejących modułów (rozmowy, `user_bookmarks`, `event_bookmarks`, wydarzenia) - bez duplikowania logiki.
- i18n PL/EN w osobnym module ładowanym z panelami.
- Testy: zapytania i funkcje serwerowe (autoryzacja, tenant), reduktory stanu paneli, render każdego panelu i pustych stanów, dodawanie/odhaczanie zadania, zapis notatki, oznaczanie materiału jako przeczytanego.

## Kolejność prac

1. Migracja bazy + typy.
2. Warstwa danych i funkcje serwerowe z testami.
3. Powłoka panelu i integracja z paskiem.
4. Kolejno panele: czat, zadania, notatki, zapisane, kalendarz, do przeczytania.
5. i18n, testy komponentów, sprawdzenie na telefonie i desktopie.
