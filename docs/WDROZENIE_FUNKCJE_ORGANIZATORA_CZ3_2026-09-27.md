# Wdrożenie: funkcje organizatora wydarzeń, część 3 - poprawki z przeglądu po wdrożeniu migracji

**Data:** 2026-09-27
**Poprzednik:** PR #413 (scalony 2026-09-27, `31ffc3890`). To NOWA zmiana, nie kontynuacja #413.
**Notatki poprzednich części:** `docs/WDROZENIE_FUNKCJE_ORGANIZATORA_2026-09-27.md` (część 1, #410),
`docs/WDROZENIE_FUNKCJE_ORGANIZATORA_CZ2_2026-09-27.md` (część 2, #413: cięcie migracji, lista wdrożenia).

## 1. Stan po scaleniu #413

- Na `main` są wszystkie migracje funkcji organizatora, pocięte na części do 45 KB. Kolejność
  zastosowania (33 pliki z `supabase/migrations`) jest w notatce części 2, sekcja 3.2.
- Baza produkcyjna jeszcze ich nie ma. Wdrożenie wykonuje Lovable, plik po pliku, w tej kolejności.
- Tych 33 plików nie zmieniamy: mogą zostać zastosowane w każdej chwili. Każda zmiana SQL w tym PR
  idzie do NOWEJ pary migracji (supabase + bliźniak drizzle), z numerem po najnowszej migracji
  na gałęzi, do 45 KB.

## 2. Zakres tego PR (lista kontrolna)

- [ ] Sprawdzenie żywej bazy przed wdrożeniem (tylko odczyt): stan oczekiwany a stan produkcji,
      instrukcje zależne od istniejących danych, zapytanie weryfikujące po wdrożeniu; osobno plik
      `20260926183100_event_participant_part3_followups` z #411.
- [ ] Skaner offline i Wallet, część 2: przepełnienie kolejki, wygasanie poświadczenia,
      czyszczenie listy przy zmianie poświadczenia, odświeżanie parowania, zakres urządzenia,
      limit per token, `callerSupabase`, `downloadBlob`.
- [ ] Lejek Google Ads: uwagi przeglądu (atrybucja między kartami, zgoda, pakiety jako konwersje,
      ROAS, parser kosztów, liczba grup raportu) i dostosowania do #403-#407.
- [ ] Plan sali: uwagi przeglądu (kolejność blokad, geometria, eksport CSV bez e-maili, metryki,
      komunikat o miejscu).
- [ ] Kopiowanie edycji: ustawienia uczestnika z #406, `_event_safe_timezone`.
- [ ] Most CRM: stan per intencja (check-in nie nadpisuje błędu naboru), deduplikacja osi czasu.
- [ ] Odświeżanie publicznej listy prelegentów po potwierdzeniu udziału i po zmianach mówców
      w agendzie; komentarz a działanie `useViewerCard`.
- [ ] Niezależny przegląd całego PR i poprawki.
- [ ] Zielone CI i pełny `events-harness`.

## 3. Wdrożenie produkcji (po scaleniu)

Najpierw 33 pliki z notatki części 2 (jeśli jeszcze nie są zastosowane), potem nowe pary migracji
z tego PR w kolejności wersji. Lista zostanie wpisana tutaj, gdy migracje będą gotowe. Starych,
niepociętych plików nie uruchamiaj ręcznie w edytorze SQL.
