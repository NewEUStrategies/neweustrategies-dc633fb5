# Prompt kontynuacji – hub „Przychód i lejek” (stan 2026-10-20 wieczór)

Wklej poniższy tekst jako pierwszą wiadomość w nowym czacie (repo
`NewEUStrategies/neweustrategies-dc633fb5`, gałąź `claude/elegant-fermat-xwfca1`,
PR #530).

---

Kontynuujesz moduł panelu admina **„Przychód i lejek”** (NES, `/admin/revenue`)
na gałęzi `claude/elegant-fermat-xwfca1` (PR #530, szkic). Pracuj po polsku.

## 1. Przeczytaj najpierw (sekcjami, nie w całości)

- `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` – dziennik: §17 (stan),
  §20 (S5), §21 (I9b i I9c: 21.7 zgłoszenia, 21.18 dla właściciela, 21.20
  domknięcia RODO, 21.21 retencja danych) i sekcje S8/S7, jeśli już powstały
  (kolejne numery po §21).
- `docs/KONTYNUACJA_HUB_PRZYCHOD_LEJEK_2026-10-19.md` – kolejka i zasady.
- `docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md` – wiążąca specyfikacja
  (≈370 KB, czytaj przez `grep -n '^#'` i `sed -n`): karty S7, S8, I9 w §8.3.
- `docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md` – rejestr czynności przetwarzania.
- `src/lib/ci/hubDelivery.ts` – manifesty wycinków, rejestr funkcji, bloki wersji.

## 2. Stan na koniec poprzedniej sesji

- W PR (CI zielone na `fcc08c55`): S3, I9a, S5, I9b (A, A2, B), I9c (X1, X2).
  Migracje do `20261020161400`, bliźniaki drizzle do `0372`.
- **S8 i S7** szły równolegle (decyzja właściciela) w workflow
  z integracją i pushem (najpierw S8, potem S7). Sprawdź `git log` gałęzi PR
  i dziennik: jeśli są commity „hub(S8): …” / „hub(S7): …” z dziennikiem –
  wycinek jest w PR (sprawdź CI). Jeśli nie – szukaj na origin gałęzi roboczych
  `hub/s8-sciezki-panel` / `hub/s7-zakladki-diagnostyka`; gdy ich nie ma, wycinek
  trzeba wykonać od nowa wg karty SPEC (S8 bez SQL; S7 z migracjami – patrz 4.3).

## 3. Kolejka (po kolei)

1. **Dokończ S8/S7**, jeśli nie są w PR (pkt 2).
2. **I9d – decyzje właściciela RODO (2)** (zatwierdzone 2026-10-20, wykonanie
   w bloku migracji I9 po najwyższej wersji):
   - **Zgłoszenia do klubów (Z-I9c-01):** po usunięciu konta anonimizacja
     (imię, nazwisko, e-mail, telefon, firma, stanowisko, miasto, profil
     społecznościowy i wszystkie pola tekstu własnego; `user_id` → pseudonim
     konta jak w `_hub_account_erase_modules`); zostają klub, specjalizacja,
     status i daty decyzji, warstwa, branża, staż, kraj, lata doświadczenia.
     Nowa kategoria retencji: odrzucone/wycofane – anonimizacja 24 mies. po
     decyzji (zakres 12–36), przyjęte – 24 mies. po końcu członkostwa,
     oczekujące – nigdy automatycznie.
   - **Odczyty licznika `metered_views` (Z-I9c-07):** kategoria 3 mies.
     (zakres 2–13; historia czytania może ujawniać poglądy – art. 9 RODO),
     przed usunięciem anonimowy agregat dzienny, wskaźniki starszych okien bez
     zmian (test).
   - **Uczestnicy wydarzeń `event_people` (Z-I9c-07):** anonimizacja 24 mies.
     od ostatniego udziału (12–36); powiązani z istniejącym kontem – do
     usunięcia konta; z płatnym zamówieniem – nie wcześniej niż koniec
     przechowywania dowodów księgowych (`accounting_retention_until`).
   - **Wygaszanie newslettera (Z-I9c-08, „tak, usuwaj”):** 12 mies. bez
     zaangażowania (zakres 6–24; kliknięcia, otwarcia ludzkie bez Apple MPP,
     logowanie konta, formularze, potwierdzenie) → jeden mail z prośbą
     o potwierdzenie (PL/EN, treść edytowalna w panelu, link z podpisanym
     tokenem resetuje licznik) → po 30 dniach bez reakcji usunięcie
     subskrybenta (bez dopisywania do listy wyłączeń); lista „do wygaszenia”
     w karcie retencji z wykluczeniem i powodem w `audit_log`.
   - **Treść zgody i pomiar („tak, uzupełnij”):** jedno źródło domyślnej
     treści zgody PL/EN we wszystkich formularzach (NewsletterForm, JoinUsForm,
     RegisterForm, AuthFormBlocks, ContactFormView, widżety buildera, popup,
     wydarzenia, CFP) z informacją o pomiarze otwarć i kliknięć i o wycofaniu
     zgody; tekstów zmienionych przez admina nie nadpisywać (ostrzeżenie
     w panelu); wersja zgody w dzienniku zgód; piksel i spersonalizowane linki
     tylko dla zgód obejmujących pomiar (wytyczne EDPB 2/2023), pozostali bez
     śledzenia; opcjonalna akcja w panelu „Poproś o zgodę na pomiar”.
   - Wszystko w karcie „Retencja danych” (`/admin/settings/privacy`)
     i mechanizmie I9c-X2; rejestr czynności i dziennik z adnotacjami
     „Zamknięte (I9d, §NN)”; testy pgTAP, vitest, RTL/axe.
3. **I9 – integracja i wydanie** (karta I9 w SPEC §8.3) oraz domknięcie
   otwartych zgłoszeń: podpięcie do `jobs-tick` runnera ścieżek
   (`runJourneysTick`, Z-S5-03), skanerów S2, `journey_rollup_daily`
   i `journey_purge` (karta retencji pokazuje „Harmonogram w przygotowaniu”);
   panel zdrowia harmonogramu; chipy huba w 13 modułach + `LeadJourneysCard`;
   ścisłe bramki (`queryKeyLiterals`, `syncManifest`, `domainMap.test.ts`);
   dokumenty rozliczeniowe (Z-S2-07); Z-S5-01 (zdarzenie
   `contact_message.submitted.v1`), Z-S5-04…08, Z-I9b-06, -09, -14, -15,
   Z-I9c-02, -03, -05, -06, -09, -10; końcowy pomiar bundla
   (`reports/bundle-baseline.json`), `docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md`,
   raport końcowy, opis PR, PR gotowy do przeglądu.

## 4. Zasady (właściciel + AGENTS.md)

1. **Panel admina:** wszystko, co powstaje, musi być operowalne z panelu
   (sekcyjne `adminPageHead` – na stronach ustawień tytuł „… - Ustawienia”,
   ⌘K, i18n PL/EN z parytetem); żadnych przełączników tylko z SQL.
2. **Migracje:**
   - ≤ 45 KiB, nazwa `^\d{14}_[a-z0-9_]+\.sql$`, idempotentne;
   - polski nagłówek DEFEKT/ZMIANA/KOLEJNOSC/IDEMPOTENTNA/DOWOD;
   - `-- CIALO-Z:` z najnowszą wcześniejszą definicją;
   - bliźniak drizzle bajt w bajt + wpis `_journal.json`;
   - nowe tabele: `tenant_id NOT NULL` FK, RLS, REVOKE dla PUBLIC/anon/authenticated, jawne GRANT;
   - SECURITY DEFINER z `SET search_path = public, pg_temp`;
   - tenant i user z sesji, nigdy z payloadu;
   - bez `supabase/migration-ledger.json`.

   **Kolejność wersji:** nowe migracje S7/I9d/I9 dostają wersje PO najwyższej
   istniejącej, żeby odtwarzanie w kolejności wersji (pgTAP, replay) i dziennik
   drizzle dawały ten sam stan. Odchylenie od bloku z SPEC zapisz w rejestrze
   dostaw.

3. **Harnessy:** migracja wspominająca `career_*`/`contact_messages`/`event_*`/
   `club_*`, która sięga też poza te moduły → znacznik
   `-- careers-harness: exclude` (lub `pg-harness`) z uzasadnieniem w nagłówku
   (wzór `20261020160900`). Zawsze uruchamiaj `check:pg-harness`,
   `check:careers-harness`, `check:events-harness`.
4. **Typecheck:** lokalny `--checkers 1` nie widzi części błędów CI – dodatkowo
   zawężony `tsgo --noEmit` z domyślnymi checkerami na zmienionych plikach,
   ich importerach i `vitest.setup.ts` (plik tsconfig tymczasowy w katalogu repo).
5. **Budżet bundla (D-08):** `public`, `publicCss`, `chunk`, `boot` zamrożone;
   `overall`/`css` – ratchet `ceil(zmierzone)+1` z wpisem kroniki
   w `scripts/check-bundle-size.ts`. Jeśli subagentowi system uprawnień
   zablokuje ratchet – orkiestrator wykonuje go sam.
6. **Jakość z bramek, bez przeglądu adwersaryjnego.** Lokalnie: format,
   `verify:static`, typecheck, lint, vitest celowany, pgTAP, harnessy, kontrakt
   TS⇄SQL, build i budżety. Pełna suita vitest – w CI. Push tylko po zielonych
   bramkach; po pushu CI – czerwone naprawiać od razu.
7. **Pamięć 16 GB, 4 rdzenie:**
   - ciężkie polecenia pojedynczo (`flock -x /tmp/hub-heavy.lock`);
   - pgTAP pod `/tmp/hub-pgtap.lock`;
   - nie uruchamiaj pełnego niskopamięciowego tsgo równolegle z czymkolwiek ciężkim;
   - workflow uruchamia maks. 2 agentów naraz.
8. **Oszczędność tokenów (limit tygodniowy):** jeden agent na wycinek,
   pakiet kontekstu zamiast czytania całego SPEC, bez powtórnych pełnych
   przebiegów, bez pętli odpytywania.
9. **Benchmarki:** liczb nie wymyślać (tylko `docs/BENCHMARKI_WSKAZNIKOW_2026-10-18.md`,
   `docs/benchmarki/**`, pakiet Insidera). Komentarze w kodzie po polsku,
   wyjaśniające dlaczego.

## 5. Po stronie właściciela (nie z kontenera)

- Wdrożenie migracji `0347…` (Lovable, migrator Drizzle) w kolejności
  z publikacją frontu; kontrolne SQL w §21.17, §21.20, §21.21.
- Retencja: 14 dni podglądu w karcie przed pierwszym czyszczeniem; okresy
  i rejestr czynności do wiadomości IOD.
- Z-I9c-04: dowody księgowe – repo trzyma do końca roku obrotowego + 6 lat
  (dłużej niż „5 lat” z polecenia) – do decyzji.
- Stripe: 3 kroki wizualne w trybie testowym (Z-I9b-13), powody rezygnacji
  w portalu klienta (Z-S2-11).
- Po I9: test na żywo ścieżek i włączenie silnika u NES (Z-S5-07).
