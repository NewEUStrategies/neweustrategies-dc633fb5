# Toasty nowych wiadomości czatu: weryfikacja

- Gałąź `feat/w3-chat-toasts`, HEAD `3c10e030`, worktree `scratchpad/wt3/chat-toasts`.
- Baza: build w `scratchpad/base-w3b` (`63a05a32`). Od `56da8d23`, czyli bazy gałęzi, różni się wyłącznie dokumentami
  (`faza3/plany/*.md`), więc porównanie jest uczciwe.
- Kodu źródłowego nie ruszałem i niczego nie commitowałem. Oba worktree są czyste (`git status` pusty).

**Werdykt: ok = true.** Domknięcie bootu anonimowej strony głównej nie urosło, tylko zmalało (−1 880 B raw,
−558 B gzip). Wszystkie bramki są zielone, e2e artefaktowe przeszło 12/12, a gość nie otwiera żadnego websocketu
i nie pobiera kodu doku ani toastów.

## 1. Build

`env BUNDLE_INVENTORY=1 bun run build:smoke` przez `heavy-bg.sh`: exit 0, 6019 modułów, 2 min 20 s. Log w `build.log`.

## 2. Bramki paczki (worktree, przez `light.sh`)

| Bramka                      | Wynik                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `check:bundle`              | exit 0, „Bundle within budget”                                                            |
| `check:chunks`              | exit 0, graf acykliczny (893 chunki, 6864 krawędzie statyczne)                            |
| `check:entry-purity`        | exit 0, ścieżka bootu czysta, 10 chunków; `sonner` na liście ciężkich modułów spoza bootu |
| `check:server-entry-purity` | exit 0, 1813 plików artefaktu serwera                                                     |

`check:bundle`, baza (`check-bundle-base.log`, ten sam skrypt) i worktree:

| Metryka                              | Baza          | Worktree      | Δ           | Próg                                  |
| ------------------------------------ | ------------- | ------------- | ----------- | ------------------------------------- |
| overall JS gzip                      | 4754,4 KB     | 4757,0 KB     | +2,6 KB     | 4772 KB (zapas 15,0 KB, było 17,6 KB) |
| public                               | 2804,0 KB     | 2806,3 KB     | +2,3 KB     | 2877 KB                               |
| admin-only                           | 1950,4 KB     | 1950,7 KB     | +0,3 KB     | -                                     |
| największy chunk (wejście `index-*`) | 262,2 KB      | 261,6 KB      | −0,6 KB     | 286 KB                                |
| CSS                                  | 95,0 KB       | 95,0 KB       | 0           | 96 KB                                 |
| **boot closure gzip**                | **487,8 KB**  | **487,3 KB**  | **−0,5 KB** | 579 KB                                |
| **boot closure raw**                 | **1598,6 KB** | **1596,7 KB** | **−1,9 KB** | -                                     |

## 3. Waga dokumentu `/` (fixture, 5 próbek)

Pliki: `document-weight.json` i `document-weight-base.json`, logi `*.log` obok.

| Metryka                               | Baza      | Worktree  | Δ                      | Próg (max)                               |
| ------------------------------------- | --------- | --------- | ---------------------- | ---------------------------------------- |
| **bootClosureRawBytes**               | 1 636 946 | 1 635 066 | **−1 880**             | 1 637 758 (zapas 2 692 B, w bazie 812 B) |
| **bootClosureGzipBytes**              | 496 041   | 495 483   | **−558**               | 496 679                                  |
| **bootBurstGzipBytes**                | 574 062   | 573 510   | **−552**               | 574 673                                  |
| **bootBurstCount**                    | 26        | 26        | 0                      | 26                                       |
| htmlRawBytes                          | 337 696   | 337 696   | 0                      | 406 180                                  |
| htmlGzipBytes                         | 52 540    | 52 546    | +6 (inne hashe w HTML) | 57 710                                   |
| preLcpTransferBytes                   | 177 698   | 177 704   | +6                     | 181 594                                  |
| modulepreloadCount / preloadedJsCount | 0 / 0     | 0 / 0     | 0                      | 0 / 0                                    |

- **Czerwonych metryk: 0** (w obu przebiegach „Waga dokumentu w progach”).
- Moduły tylko-serwerowe nie trafiają do bundla klienta.
- Zestaw bootu (`#nes-boot-set`, 26 URL-i) ma po nazwach chunków **identyczny skład** jak w bazie. Nie ma w nim
  żadnego chunku doku, czatu, powiadomień ani `sonner`.

## 4. Chunki

Narzędzia: `verify-tools/chunkdiff.mjs` i `bootdiff.mjs`. Wyniki: `chunk-diff.txt` i `boot-diff.txt`.

### Kod toastów i doku jest tylko w leniwych chunkach członka

- `useIncomingChatToasts.ts` (7409 B) przeszedł z `ChatUnreadBadge-*` do `DockEmptyState-*`. To chunk z
  `WorkspaceDock.tsx`, `MinimizedChats.tsx` i `minimizedChats.ts`.
- `DockEmptyState-*` ma jedyny importer z wejścia, i to **dynamiczny** (`index-*`, `lazy()` w `SiteChrome`).
  Statycznie importują go wyłącznie leniwe panele doku.
- Rozmiar `DockEmptyState-*`: 62 708 → 71 171 B raw (+1541 B gzip).
- `ChatUnreadBadge-*` stracił hak i krawędź do `vendor-sonner`: −168 B raw.
- `vendor-sonner-*`: `sonner.tsx` +284 B raw (+89 B gzip). Doszła krawędź do `vendor-i18n`, który i tak jest
  w bootcie, więc nie powstaje nowe żądanie.
- `tableChannelHub.ts` (`expertRequestStatus-*`), `useNotifications.ts` i `preferences.ts`
  (`NotificationsUnreadBadge-*`, chunk bez zmian) leżą poza bootem.
- Z chatu w domknięciu bootu są tylko moduły, które były tam już w bazie: `keys`, `expertRequestDialogBus`,
  `expertRequestsSearch` i `realtime/correlationContext`. `realtime-js` siedzi w `vendor-supabase`, który był w bootcie
  już wcześniej.

### Do domknięcia bootu nie wchodzi ani jeden moduł

- Wychodzi 13 małych modułów, razem 2942 B: `crm/profileSyncView`, `observability/vitalsThresholds`,
  `audio/playbackBus`, `billing/atoms/MoneyText`, `profile/ownProfile`, `crm/text` i 7 zaślepek
  `?tsr-split=errorComponent/notFoundComponent/loader`.
- Trafiają do leniwych `text-*`, `events._slug.agenda-*` i `CalendarView-*`.
- To efekt uboczny przegrupowania Rollupa (`experimentalMinChunkSize: 2048`, `vite.config.ts:342`). Nowe krawędzie
  doku (`useNotifications`, `tableChannelHub`, `display`) zmieniły zbiory importerów współdzielonych modułów. Zmiana
  sama w sobie tego nie zamierza.

### Oczekiwanie z IMPL-fix1 spełnione częściowo

Raport zapowiadał zmiany tylko w `DockEmptyState-*`, `ChatUnreadBadge-*`, `vendor-sonner-*` i ewentualnie
`NotificationsUnreadBadge-*`. Faktycznie zmieniło się 25 chunków:

- te trzy (`NotificationsUnreadBadge-*` bez zmian);
- wejście (−2967 B raw);
- `i18n-chat` (+21 B);
- przetasowanie małych współdzielonych chunków: nowe `notificationText-*`, `text-*`, `display-*`,
  `club._clubSlug-*`, `club._clubSlug.minisite-*`; zniknęły `noteContext-*`, `ClubWorkspaceEmpty-*`,
  `web-stories._slug-*`, `pricing-*`; urosły `CalendarView-*`, `ClubEntryIcon-*`, `events._slug.agenda-*`.

Bramek to nie przekracza (overall +2,6 KB przy 15 KB zapasu), ale skład jest szerszy, niż zakładał raport.

## 5. Gość na `/` w przeglądarce (Playwright, Chromium 1194)

- Narzędzie `verify-tools/guest-probe.mjs`, uruchomione przez mutex. Wynik w `guest-probe.json` i `guest-probe.log`.
- Artefakt startuje przez `startArtifact` w trybie fixture.
- Profile desktop 1366×900 i mobile 390×844.
- Sekwencja: load, 4 s, przewijanie i ruch myszy, 11 s ciszy.
- Websockety przechwycone (`routeWebSocket`), żądania spoza origin artefaktu przerwane.

|                             | Baza desktop | Worktree desktop | Baza mobile | Worktree mobile |
| --------------------------- | ------------ | ---------------- | ----------- | --------------- |
| websockety (w tym realtime) | 0            | **0**            | 0           | **0**           |
| żądania do Supabase         | 44           | 44               | 48          | 48              |
| pliki JS                    | 77           | 78               | 77          | 78              |
| JS gzip łącznie (15 s)      | 760 468 B    | 761 058 B        | 760 468 B   | 761 058 B       |
| dok w DOM                   | nie          | nie              | nie         | nie             |
| `pageerror`                 | 0            | 0                | 0           | 0               |

**Żądania do Supabase.** Wszystkie to publiczne REST tabel treści i odpowiadają 1:1 bazie: `site_design_tokens`,
`post_layout_settings`, `ad_placements`, `newsletter_settings`, `builder_popups`, `posts`, `categories` i `tags`.
Liczba obejmuje ponowienia po przerwaniu. U gościa jest **zero** żądań do `conversation_participants`,
`conversations`, `notification_preferences`, `get_chat_peers` i `/realtime/`. Gość nie ma też w `localStorage`
kluczy sesji `sb-*`.

**Pliki JS.** Gość nie pobiera chunku doku (`DockEmptyState-*`), `ChatUnreadBadge-*`, `NotificationsUnreadBadge-*`,
`ChatSideDrawer-*` ani `ChatWindow-*`. `vendor-sonner-*` pobiera tak samo jak w bazie (leniwy `<Toaster/>`
po bezczynności).

**Jedyna różnica zestawu JS gościa.** Po boocie worktree pobiera `events._slug.agenda-*` (954 B gzip) i `text-*`
(1027 B gzip) zamiast `web-stories._slug-*` (992 B gzip). Łącznie to +1 żądanie i +590 B gzip w całym oknie 15 s,
przy −558 B gzip w samym bootcie. Przyczyną jest to samo przegrupowanie Rollupa: moduły wypchnięte z wejścia gość
nadal potrzebuje, więc dociąga je później. To uwaga, nie blokada.

**Konsola.** 52 i 53 błędy konsoli w obu wariantach to „net::ERR_FAILED” od żądań przerwanych przez sondę.

## 6. E2E artefaktowe

`env NES_ARTIFACT_FIXTURE=1 bun run test:e2e:artifact` przez `heavy-bg.sh`: **12/12 passed** (58,2 s), exit 0.
Log w `e2e-artifact.log`.

- Przeszły `boot-artifact` (hydratacja, interaktywność, brak niezgodności, kontrola negatywna), `boot-home`
  (pl, en, zapisana sesja), `boot-timing` (budżet, cache HIT, Link modulepreload) i `motion-gate.boot-home` (3 testy).
- `boot-timing`: TTFB 6,8 ms, gotowość 502 ms, bootJS 1886,7 KB / 29 plików (statyczne 1599,7 KB / 10), FCP 404 ms.
- Wpis `[hydration-mismatch] ... #418` pochodzi z zamierzonej kontroli negatywnej (test 5), nie z regresji.

## 7. Problemy i uwagi (nieblokujące)

1. **Przegrupowanie Rollupa zmienia 25 chunków, nie 3-4 zapowiadane w IMPL-fix1.**
   - Wejście maleje o 2967 B raw, a boot o 1880 B raw.
   - Gość po boocie robi o 1 żądanie więcej (+590 B gzip).
   - Zysk na bootcie jest przypadkowy: przy scalaniu z innymi gałęziami fali Rollup może przegrupować chunki inaczej.
     **Waga dokumentu i `check:bundle` trzeba zmierzyć ponownie na scalonym czubku fali**, zwłaszcza
     `bootClosureRawBytes`, który na czubku fali ma podobno ok. 155 B zapasu. Tutaj zapas wynosi 2692 B, liczony
     od progu w tym worktree.
2. **Zapas `overall` w `check:bundle` spada z 17,6 KB do 15,0 KB (0,31%).** Bramka jest zielona, ale ostrzeżenie
   „zapas poniżej 2%” było już w bazie.
3. **Ścieżka zalogowana nie ma tu testu e2e.** Sam toast, kanał realtime i akcja „Otwórz rozmowę” wymagają stosu
   Supabase z realtime. To samo zgłosił IMPL: potrzebny jest osobny seeded e2e z dwoma kontekstami.

## Pliki

W `scratchpad/phase3/side/chat-toasts/verify/`:

- `build.log`, `check:*.log`, `check-bundle-base.log`;
- `document-weight{,-base}.{json,log}`;
- `chunk-diff.txt`, `boot-diff.txt`;
- `guest-probe.{json,log}`, `guest-probe-*-server.log`;
- `e2e-artifact.log`.

Skrypty pomocnicze leżą w `scratchpad/phase3/side/chat-toasts/verify-tools/`.
