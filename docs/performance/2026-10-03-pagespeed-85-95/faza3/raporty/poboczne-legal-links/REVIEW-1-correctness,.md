# Recenzja 1 - poprawność, zgodność i UX: „Podłącz pasek linków prawnych (CopyrightBar)”

Werdykt: **approve** (decyzja `not_performed` jest właściwa). Luka prawna jest jednak prawdziwa i trzeba ją zlecić osobno.

## Zakres i stan worktree

- Worktree `wt3/chat-toasts`: HEAD == `claude/zen-ritchie-hzur21` (56da8d23), zero commitów. `git diff base...HEAD` jest pusty.
- Jedyna zmiana w drzewie (niezacommitowana) to `src/lib/chat/useIncomingChatToasts.ts`. Dotyczy toastów czatu, a nie linków prawnych. Do tego zadania nie należy, więc jej tu nie oceniam.
- Prośba użytkownika przekazana przez harness brzmi „Napraw toasty nowych wiadomości czatu”. Podłączenie CopyrightBar wykracza poza nią. Pominięcie zadania jest więc zgodne z zakresem, który wyznaczył użytkownik.

## Weryfikacja twierdzeń wyjściowych (sprawdzone samodzielnie)

- `CopyrightBar` nie jest nigdzie zamontowany. Odwołują się do niego tylko testy (`Footer.test.tsx`, `footerChrome.test.tsx`) i komentarze (`__root.tsx:707`, `footerNavigation.ts:75`, `siteSettingsLiveSync.tsx:2`). Potwierdzone.
- Lista linków prawnych w `src/lib/seo/footerNavigation.ts:58-93` (grupa `legal`, etykiety PL/EN):
  `/regulamin`, `/polityka-prywatnosci`, `/zwroty-i-reklamacje`, `/cookies`, `/wytyczne-dotyczace-reklam`, `/regulamin-subskrypcji-i-zakupow`, `/rodo`, `/moderacja-komentarzy`.
- Produkcyjny HTML strony głównej (`w3/prod/d2.html`) zawiera z tej grupy tylko `/polityka-prywatnosci` i `/privacy`. Brakuje linków `/regulamin`, `/zwroty-i-reklamacje`, `/cookies` i `/rodo`. **Luka zgodności (wymóg operatora płatności) istnieje.**

## Ustalenia

1. **minor** - brak raportu wykonawcy (pole raportu jest puste). Decyzja `not_performed` nie ma uzasadnienia na piśmie.
   Poprawka: dopisać jedno zdanie, np. „poza zakresem prośby użytkownika (toasty czatu); luka potwierdzona: brak /regulamin, /zwroty-i-reklamacje, /cookies, /rodo w SSR /”.
2. **major (poza zakresem tej partii, do osobnego zadania)** - strony publiczne nadal nie mają kompletu linków prawnych.
   Dowód: grep po `d2.html` wyżej. Komentarz w `src/components/footer/CopyrightBar.tsx:13-14` deklaruje wymóg, którego produkcja nie spełnia.
   Poprawka: osobne zadanie, które zamontuje `CopyrightBar` (lub `<nav aria-label>` z `footerLinksByGroup("legal")`) wewnątrz wyspy stopki, renderowany w SSR, bez nowego JS w domknięciu bootu.
   Montaż stopki przebiega przez `src/routes/__root.tsx`, a ten plik jest na liście zakazanych w tej fali. Zadanie wymaga więc koordynacji (`out_of_scope_needs`: `src/routes/__root.tsx`).
3. **minor (dla przyszłej implementacji)** - `CopyrightBar.tsx` używa `Link` z TanStack.
   Przy montażu trzeba sprawdzić, że w wariancie EN prowadzi do właściwych tras: slugi są polskie, a w produkcji istnieje też `/privacy`. Trzeba też uniknąć duplikatu `/polityka-prywatnosci`, który stopka CMS już renderuje.

## Bramki

Nie uruchamiałem eslint ani vitest: zadanie nie dotknęło żadnego pliku.
