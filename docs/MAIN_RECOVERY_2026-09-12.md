# Naprawa main - 12.09.2026

Baza audytu: `b9c3fca6c9dd25604b6f0e6b891b044eaa518fb4`.
Baza integracji: aktualny `main` po PR #348 (`3ee6d78`). Zmiany importu danych wykresów zachowano; kolidujące atrapy mediów połączono.
Kontynuacja obejmuje również `main` po PR #349 (`3b8c374`), w tym nowe regiony i zasoby map.
Gałąź: `fix/main-recovery-2026-09-12`.

## Zakres zmian

- Pełne sprawdzanie typów aplikacji i skryptów wykonywanych przez CI.
- Naprawa wspólnych atrap mediów i CRM oraz testów kontraktów tras, adresów kanonicznych i debugowania buildera. Progi jakości pozostają bez obniżania.
- Deterministyczny cykl timerów paska nawigacji; limit listy i stały czas początku w kluczach zapytań klubów.
- Sonda odnowień: jednoznaczne tryby, kontrola konfiguracji, bounded polling, jawne niepowodzenia i test pełnego CLI bez kontaktu z operatorem płatności.
- CRM: transakcyjny zapis firmy i kontaktu, deduplikacja w tenancie, utrwalenie nieudanej zmiany planu w `member_crm_sync_pending`, jawny wynik częściowy i ponawialny odczyt stronami zamiast limitu 2000 członków.
- Kompatybilność starego `wallpaper=soft` z nowym schematem czatu, test danych zastanych, dostępny tekst obecności rozmówcy.
- Zgodność domyślnych profili społecznościowych stopki z konfiguracją aplikacji, bez edytowania historycznych migracji.
- SheetJS 0.20.3 z oficjalnego archiwum; podgląd w workerze, limit 20 MiB, 10 arkuszy, 1000 wierszy, 100 kolumn, 2 MiB HTML i 10 sekund. Dokument ponad limit wymaga pobrania i otwarcia lokalnie. Wynik nadal przechodzi DOMPurify.
- Jeden budżet 4 sekund dla loadera bloga; ustawienia mają najwyżej 500 ms, a odpowiedź zdegradowana nie trafia do wspólnego cache.
- Pomiary pierwszej wizyty: osobne cold/warm PL/EN, po trzy próbki na wariant, identyczny serwer i dane, porównanie median baseline/candidate oraz dotychczasowe limity bezwzględne.
- Formularze popupu rejestracji i renderer dokumentu newslettera pobierają się dopiero po otwarciu odpowiedniego wariantu. Wyzwalacze, koordynacja nakładek i zamykanie pozostają w lekkiej obudowie; stan ładowania ma własną granicę Suspense.
- Testy odczytów i mutacji doku obejmują błędy bazy, wylogowanie, kontekst notatek, sortowanie, nieistniejące zakładki, zmianę miesiąca oraz brak powtórnego pobierania świeżych danych przy ponownym wskazaniu panelu.
- Timer potwierdzenia kopiowania adresu webhooka jest odnawiany po kolejnym kliknięciu i usuwany przy odmontowaniu. Test nie polega już na przypadkowym upływie dwóch sekund podczas innych testów.
- Cztery shardy testów, scalenie wszystkich raportów i egzekwowanie istniejących progów w wymaganym jobie `test`. Kontrola kompletności czterech raportów i sukcesu każdego sharda.
- Własność wszystkich dziewięciu domen przypisana do Fundacji New European Strategies zgodnie z dyspozycją właściciela z 12.09.2026; aktywny CODEOWNERS @NewEUStrategies. Wspólny status `Required release checks` oraz gotowy plik reguł ochrony `main`.

## Wdrożenie bazy

1. Sprawdzić kopię zapasową i listę oczekujących migracji na docelowej bazie.
2. Dla bazy ze starymi danymi czatu uruchomić `scripts/migrate-with-preflight.sh` z jawnym `NES_MIGRATION_DATABASE_URL`. Preflight normalizuje `soft` do NULL **przed** historyczną migracją dodającą CHECK. Samo dodanie późniejszej migracji nie naprawiłoby zablokowanego upgrade'u.
3. Zastosować migracje CRM, kompatybilności czatu i aktualizacji domyślnych profili stopki.
4. Dopiero po migracjach wdrożyć kod używający nowych RPC. Uruchomić kontrole kontraktu bazy i rejestru migracji.
5. W katalogu członków uruchomić synchronizację CRM. Błąd pozostawia kursor ostatniego zakończonego rekordu w otwartym widoku; ponowne kliknięcie kontynuuje. Po przeładowaniu widoku odczyt zaczyna się od początku, ale zapisy są idempotentne, a intencje nieudanych zmian planu pozostają w bazie.

Nie wywoływano produkcyjnej migracji ani rzeczywistej operacji płatniczej podczas przygotowania zmian.

## Odzyskiwanie

- Nie usuwać `member_crm_sync_pending` przy rollbacku aplikacji. Trigger utrwala intencję w transakcji nadania lub odebrania planu, także przed wywołaniem RPC przez aplikację. Zachowuje niedokończone zmiany członkostwa; zawiera tylko kod SQLSTATE zamiast treści błędu z danymi osobowymi.
- Backfill odtwarza najpierw oczekującą zmianę grant/revoke. Nieudany zapis firmy lub kontaktu nie zmienia poprzedniego kontaktu.
- Ręczny grant pozostaje zapisany także przy awarii CRM; panel pokazuje ostrzeżenie. Po odzyskaniu bazy ponowić synchronizację.
- Starszy klient czatu może wysłać `soft`; RPC zapisze NULL, czyli dotychczasowy domyślny gradient.

## Ochrona wydania

Plik `governance/release/main-ruleset.json` jest gotowym payloadem dla API reguł repozytorium. Włączyć go po potwierdzeniu zielonych statusów na tej gałęzi. Wymaga uprawnień administracyjnych repozytorium, których połączenie użyte do tej naprawy nie udostępnia. Payload nie został zastosowany.

Reguła wymaga niezależnego review, Code Ownera, aktualnej bazy PR i zielonych kontroli. Konto autora nie może zatwierdzić własnego PR; przy jednoosobowej obsadzie potrzebny jest drugi uprawniony recenzent. Utrzymanie i zastępstwo są rolami instytucjonalnymi Fundacji New European Strategies, a nie deklaracją dwóch niezależnych wykonawców.

Dowody wykonania i ostateczne statusy CI znajdują się w PR tej gałęzi. Nie traktować samego istnienia workflow jako dowodu włączenia ochrony gałęzi ani pomiarów na fixture jako metryk produkcyjnych.
