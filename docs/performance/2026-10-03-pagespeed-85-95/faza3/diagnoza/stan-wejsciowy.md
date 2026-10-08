# Notatki orkiestratora - fala 3 (sesja 2026-10-08)

## Stan wejściowy
- PR #476 (fala 2) scalony do main 2026-10-06 (3ec18dd1) i wdrożony przez Lovable (f213e561). Gałąź claude/zen-ritchie-hzur21 przesunięta FF do origin/main 7c924ae5.
- Sekret PSI_API_KEY nie jest ustawiony: psi.yml kończy się na zielono bez próbkowania (3 przebiegi 10-05..10-07). Anonimowe API PSI = 429.
- CrUX: za mało danych dla originu (link właściciela) - CWV oceniane wyłącznie laboratoryjnie.

## Produkcja (LH 13.5 z kontenera, kolo IAD, Chrome 141, symulowane dławienie, UA Chrome-Lighthouse, Accept-Language pl)
- mobile-1 odrzucony (bench 1378, świeży kontener, rywalizacja CPU).
- mobile-2: 87; FCP 2,18 LCP 3,25 SI 2,96 TBT 190 CLS 0; obs SI 1101; TTFB 100 ms (HIT).
- mobile-3: 85; FCP 1,94 LCP 2,99 SI 4,01 TBT 291 CLS 0,0014; obs SI 1849 - slider hero przeskakuje na 2. slajd ok. 8,1 s (speedline: 85-86% od 1,06 s do 8,2 s).
- desktop 1-3: 80/95/97; TTFB 0,91-1,33 s (MISS we wszystkich trzech), FCP obs 2,0-2,2 s; SI 2,64/2,02/1,77; LCP 2,49 (obraz hero 3,07 s ładowania)/0,89/0,78; CLS 0,0164 w d3 (div.relative.w-full.h-full po załadowaniu fontu latin).
- SI Lantern 13: mobile SI = 1,4*obsSI + 0,4*layoutSI (intercept 0), desktop ~0,575*obsSI + 0,49*layoutSI; max(FCP). layoutSI mobile prod ~3,55 s, desktop ~1,1-1,4 s.
- curl: mobile UA MISS 3x z rzędu, TTFB 2,8-3,9 s, 185 KB (render zdegradowany), server-timing db n=4..7 1,3-1,7 s, edge-routing ~700 ms (zimny izolat); HIT ~500 KB.
- HTML czysty 500 KB: $tsr (dane loaderów routera) 88,7 KB, dehydrated RQ 9,8 KB, brand-tokens style 26,7 KB, img (srcset 9 szerokości, absolutne URL) 105 KB, class 75 KB, style attr 44 KB.
- CSS blokujący: jeden arkusz styles-*.css 542 KB raw / 78,8 KB gz; warstwa utilities 341 KB (3013 reguł, 342 użytych na stronie głównej fixture).
- ~flock.js (analityka Lovable wstrzykiwana przez hosting, defer) - zadanie 59 ms sym. na mobile; poza kodem repo (ustawienie projektu Lovable).
- Obraz hero /media/... przez worker (nes-edge BYPASS, bez cf-cache-status): TTFB 2,5 s zimny izolat (edge-routing 667 ms), 0,26-0,35 s ciepły.
- Klient po boocie: 7 zapytań Supabase + 7 preflight (site_design_tokens, post_layout_settings, ad_placements, newsletter_settings, builder_popups, categories, tags); na produkcji 5 z nich podwójnie.

## Baza lokalna W3 (main 7c924ae5, fixture, ramię bot, n=3)
- mobile 93 (TBT 55/260/359), desktop 100 (1 przebieg 468 ms po restarcie serwera), desktop4x 81 (TBT 346-475).
- Księga d4x-2: ScriptCatchup 181, Script:(dokument) [Style 73%] 146 (wymuszony układ loadera przy DCL, K4i), vendor-react 54, Timer:index 19.
- Księga m-1: ScriptCatchup 101, Style 70, vendor-react 54, Timer:dynamic-icon 23.
- Harness nie odtwarza kary SI za autoplay (ślad kończy się ~1 s po ciszy, fixture ładuje się w ~1 s).
