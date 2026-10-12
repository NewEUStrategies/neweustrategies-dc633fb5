# Skaner on-site: osobny origin, token we fragmencie, kolejka bez utykania

Data: 2026-10-12 · Gałąź: `ops/s3-scanner-client` · Ustalenia audytu: OPS-05, OPS-06, OPS-07, OPS-13

## Co zmienia kod (bez SQL)

- **OPS-05 - kolejka nie utyka.** Awaria przejściowa (sieć, termin żądania,
  5xx, `device_locked`, `rate_limited`) przesuwa wyłącznie termin następnej
  próby: bez limitu prób, wycofanie z rozrzutem i sufitem 60 s
  (`OUTBOX_DISPOSITIONS` w `scannerOutbox.ts`). Start aplikacji, `online`
  i `visibilitychange` zerują wycofanie i wysyłają od razu. Trzy porażki
  przejściowe z rzędu (albo blokada urządzenia) kończą bieżący przebieg.
  Panel kolejki ma „Ponów" przy pozycji i „Ponów wszystkie"; usunięcie pyta
  o potwierdzenie. Skan na żywo z `device_locked` dostaje decyzję z listy
  offline (OPS-04, strona klienta) i trafia do kolejki.
- **OPS-06 - bez jawnych kodów na dysku.** Kolejka w IndexedDB trzyma kod,
  notatkę i znacznik kolejki wyłącznie w bloku AES-GCM (klucz HKDF-SHA-256
  z tokenu urządzenia, nieeksportowalny `CryptoKey`, losowy 96-bitowy IV,
  identyfikator pozycji jako AAD) - `scannerVault.ts`. Lista odrzuconych
  i eksport (CSV/JSON) niosą skrót SHA-256 (ten sam co `qr_token_hash`)
  i 6 pierwszych znaków kodu. Rekordy sprzed zmiany są przepisywane przy
  starcie. Bez WebCrypto kod nie trafia na dysk (kolejka żyje w karcie, ekran
  ostrzega). Lista osób ma termin poświadczenia i znika po nim przy starcie
  i co minutę. Odłączenie (z potwierdzeniem, gdy coś nie wyszło) kasuje token,
  kolejkę, listę osób, sesję, odrzucone i konflikty.
- **OPS-07 - token we fragmencie.** Link parowania to `/scanner#t=<token>`
  (fragment nie idzie na serwer). Trasa czyta go raz i zdejmuje przez
  `history.replaceState`. Trasa nie ma `validateSearch`; stary link `?t=` NIE
  paruje - adres jest czyszczony, a ekran prosi o nowy kod QR.
- **OPS-13 - osobny origin (opcjonalnie).** `VITE_SCANNER_ORIGIN`: panel
  buduje link pod originem skanera; `/scanner` pod originem portalu przenosi
  urządzenie (token we fragmencie) i kasuje dane skanera z originu portalu -
  chyba że są tam niewysłane skany albo lista do wyjaśnienia: wtedy skaner
  pracuje dalej z banerem „Przejdź pod nowy adres" (aktywnym po opróżnieniu
  kolejki). Bez zmiennej - zachowanie jak dotąd.

## Wdrożenie osobnego originu skanera (OPS-13) - kroki infrastruktury

Kod obsługuje osobny origin, ale go nie tworzy. Kolejność ma znaczenie: zmienna
środowiskowa na końcu, bo od niej panel zaczyna wydawać linki pod nowy adres.

1. **DNS.** Rekord dla `scan.<domena>` (np. `scan.neweuropeanstrategies.com`)
   wskazujący na tę samą strefę Cloudflare co portal (proxy włączone).
2. **Trasa Workers.** Dodać `scan.<domena>/*` do tras TEGO SAMEGO Workera, który
   serwuje portal (ten sam build - skaner, `/scanner-sw.js`, `/scanner/*`,
   `/assets/*` i `/_build/*` muszą przyjść spod nowego hosta).
3. **Ograniczenie hosta do skanera - WYMAGANE, inaczej OPS-13 nie jest domknięte.**
   Origin skanera nie może serwować reszty portalu (treści CMS pod tym samym
   originem co token w `localStorage` to dokładnie ryzyko OPS-13). Reguła
   przekierowania Cloudflare (Rules → Redirect Rules), 302 na origin portalu:
   `http.host eq "scan.<domena>" and not starts_with(http.request.uri.path, "/scanner") and not starts_with(http.request.uri.path, "/assets/") and not starts_with(http.request.uri.path, "/_build/") and http.request.uri.path ne "/scanner-sw.js" and http.request.uri.path ne "/favicon.ico"`.
   Ścieżki zasobów należy sprawdzić na buildzie produkcyjnym (lista
   prefiksów z `isScannerPrecacheUrl` w `scannerPwa.ts`). Obrona w głębi po
   stronie aplikacji (strażnik hosta w potoku żądań) jest przekazana dalej -
   patrz „Co zostaje".
4. **Najemcy.** Nie trzeba wpisywać `scan.<domena>` do `tenants.domain`.
   Płaszczyzna urządzenia wyprowadza najemcę, wydarzenie i zakres z tokenu
   (`_event_scanner_device_auth`), a nie z hosta; nieznany host w płaszczyźnie
   treści spada na najemcę domyślnego, a powierzchnie crawlera są dla niego
   zamknięte (`classifyCrawlHost` -> `unknown`, robots `Disallow: /`). Jeden
   origin skanera obsługuje wszystkich najemców wdrożenia. Sprawdzone w kodzie:
   klient wysyła `x-tenant-host: scan.<domena>` bez poświadczenia krawędzi
   (`tenant-host-fetch.ts`), `public_tenant_id()` spada wtedy na najemcę
   domyślnego, a żadna funkcja płaszczyzny urządzenia
   (`_event_scanner_device_auth`, `event_scanner_bootstrap`,
   `event_checkin_record`, `event_lead_scan_record`, `event_scanner_roster`)
   nie czyta hosta - najemcę, wydarzenie i zakres daje wyłącznie token.
   Jedyny skutek hosta: powłoka strony (motyw, czcionki) jest najemcy
   domyślnego; skaner nie ma nagłówka ani stopki serwisu, więc to kosmetyka.
   Gdyby wdrożenie chciało powłoki per najemca, potrzebny byłby host skanera
   per najemca (`scan.<domena-najemcy>` w `tenants.aliases`) - wtedy
   `VITE_SCANNER_ORIGIN` (jedna wartość na build) nie wystarcza.
5. **CSP i CORS.** Bez zmian: `connect-src 'self'` + origin Supabase działa
   tak samo pod nowym hostem, a PostgREST nie ogranicza originów.
6. **Zmienna.** `VITE_SCANNER_ORIGIN=https://scan.<domena>` w środowisku buildu
   (czysty origin https, bez ścieżki - inaczej jest ignorowana). Po wdrożeniu:
   - nowe kody QR w panelu prowadzą pod `https://scan.<domena>/scanner#t=…`;
   - telefony z tokenem pod originem portalu przy pierwszym otwarciu `/scanner`
     przenoszą się same (token we fragmencie), a dane skanera znikają
     z originu portalu; zainstalowaną aplikację (PWA) trzeba zainstalować
     ponownie spod nowego adresu.
7. **Weryfikacja.** `https://scan.<domena>/scanner` paruje kodem z panelu;
   `https://scan.<domena>/` przekierowuje na portal; w DevTools pod originem
   portalu po wejściu na `/scanner` nie ma klucza `nes.scanner.device-token`.

## Co zostaje (infrastruktura i inne strumienie)

- Krok 3 (ograniczenie hosta) to praca infrastruktury - kod nie może sam
  zabronić Workerowi serwowania portalu pod hostem skanera. Strażnik hosta
  w potoku żądań (`src/start.ts`/`src/server.ts`) wymaga zmiany poza tym
  strumieniem.
- Kasowanie starego klucza `nes.scanner.device-token` odbywa się przy wejściu
  na `/scanner` pod originem portalu. Kasowanie przy KAŻDYM starcie portalu
  (telefon, który już nie otworzy `/scanner`) wymaga jednej linii w korzeniu
  aplikacji - przekazane dalej.
- Token wysłany przez stary link `?t=` już przeszedł przez logi: ekran prosi
  o nowy kod, ale unieważnienie starego poświadczenia jest decyzją organizatora
  w panelu (Wydarzenia → Na miejscu → Urządzenia).
