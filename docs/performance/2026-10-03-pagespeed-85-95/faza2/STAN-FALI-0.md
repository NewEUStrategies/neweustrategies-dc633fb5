# Stan fali 0 (zapis przed przerwą limitu, 2026-10-04 08:45 UTC)

> **Stan końcowy (2026-10-04 11:40 UTC).** PR #467 scalony do `main` o 11:30 UTC (merge d466993, zawiera wszystko do
> 966583c). Po scaleniu fali 0 CI było czerwone w trzech nowych miejscach i zostało naprawione w cc43efd: test
> `serverEntryRequestOptions` (przypinał wiersz logu dokumentu sprzed P0.4), format i lint surowych artefaktów P0.5
> (katalog `raporty/P0.5-robocze/` wyłączony z prettier i eslint). Bramki na scalonym drzewie: `bun run typecheck`
> zielony (6 min 37 s), `bun run verify:static` 33 bramek OK (3 min 43 s). `check:bundle` pozostaje czerwony tak samo
> jak `main` przed PR (`spreadsheet.worker` +157 KB). Gałąź `perf/pagespeed-mobile85-desktop95-t595d6` wznowiona z
> `main`; plan fal 1 i 2 z promptami idzie jako PR #468. Poniższa tabela i instrukcja wznowienia są historyczne.

**Aktualizacja 08:45:** na polecenie właściciela („review nie jest potrzebny teraz, zakończ implementację”) gałęzie
`perf/w0-P0.3`, `perf/w0-P0.2`, `perf/w0-P0.6` (commit cac56cf) i `perf/w0-P0.1` zostały scalone do gałęzi PR bez etapu
recenzji (merge --no-ff, bez konfliktów). Bramki repo na scalonym drzewie (typecheck, verify:static, build:smoke,
check:document-weight) NIE były jeszcze uruchamiane; to pierwszy krok po wznowieniu. P0.4 i P0.5 pozostają bez commita.

Orkiestrator: Fable 5.1 (ultracode); wykonawcy: agenci Opus 5.5 w dwóch workflowach
(`wf_8083dde8-726`: P0.1, P0.3, P0.6; `wf_f0771b98-74b`: P0.5, P0.2, P0.4), skrypt `workflow-faza2-wave.js`.
Worktree pozycji: `$SCRATCH/wt/<id>`, gałęzie `perf/w0-<id>` z bazy `perf/pagespeed-mobile85-desktop95-t595d6` @ 36f5f82.

| pozycja | stan                                                                                    | commit w worktree | dalej                                              |
| ------- | --------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------- |
| P0.1    | implementacja zakończona, IMPL.md zapisany (raporty/P0.1-IMPL.md), recenzja nie ruszyła | 1ec5d75           | recenzja, poprawki, scalenie                       |
| P0.2    | implementacja zakończona (IMPL w raporty/P0.2-IMPL.md), czeka na recenzję               | 868b2a6           | recenzja, poprawki, scalenie                       |
| P0.3    | implementacja zakończona, 60 testów zielonych, czeka na recenzję                        | fa26999           | recenzja, poprawki, scalenie                       |
| P0.4    | IMPL.md jest, bramki (typecheck, verify:static) w toku, bez commita                     | brak (5 plików)   | wznowić z `resume: true`                           |
| P0.5    | księgi per zadanie zebrane (art, art2), raport rep-mobile/rep-desktop.md w `phase2/p05` | brak              | wznowić; odrzucić przebiegi z load > 4 (nr 6 do 8) |
| P0.6    | IMPL.md jest, bramki w toku, bez commita                                                | brak (2 pliki)    | wznowić z `resume: true`                           |
| P0.7    | odłożone (cron rozgrzewania; decyzja później)                                           | —                 | —                                                  |

## Ustalenia do zapamiętania

- Agenci P0.2 i P0.3 wpisali w stopce commita własną nazwę modelu. Przy scalaniu `perf/w0-*` ujednolicić stopkę
  na wymaganą przez harness (`Co-Authored-By: Claude Fable 5.1` + `Claude-Session`), np. `git commit --amend` na
  nieopublikowanych gałęziach pozycji.
- P0.5 zapisuje `load=` przy każdym przebiegu Lighthouse (`art2/*-summary.txt`). Ważne są przebiegi w0q 1 do 5
  (load 1,0 do 2,8); przebiegi 6 do 8 (load 4,1 do 39) i `prof-*` (load ok. 10) są nieważne i nie mogą wejść do
  księgi ani do raportu.
- Jeden mutex maszyny `$SCRATCH/.heavy-lock` dla typecheck, build i Lighthouse (patrz skrypt fali); dwa równoległe
  `tsc` kończyły się OOM.
- CI na PR #467 czerwone tak samo jak na `main` (`check:bundle` overall 4806,5 KB > 4772 KB przez
  `spreadsheet.worker`); komentarz z diagnozą jest na PR.

## Jak wznowić

1. Sprawdzić, które pozycje mają wynik w `journal.jsonl` obu workflowów (wpisy `result` z `key`), i stan worktree
   (`git -C $SCRATCH/wt/<id> status --short`, `git log -1`).
2. Uruchomić skrypt fali z `args.items` tylko dla niedokończonych pozycji: pozycje z commitem, ale bez recenzji,
   wymagają etapu recenzji (skrypt zaczyna od implementacji; dla nich podać `resume: true` i w `notes`
   napisać, że implementacja jest zakończona i commit istnieje, więc etap implementacji ma tylko potwierdzić stan).
   Pozycje bez commita: `resume: true`.
3. Po recenzjach scalić `perf/w0-*` do gałęzi PR (merge, nie rebase), uruchomić bramki na scalonym drzewie,
   przebudować i ponownie zmierzyć bazę (PLAN.md §2), zatwierdzić i wypchnąć; potem fala 1 (P1.1, P1.2, P1.3,
   P1.4, P1.6, P1.7).
