# Narzędzia maszyny (fala 3)

Pomocnicy, którymi orkiestrator i agenci fali 3 serializowali ciężkie kroki na jednej maszynie (build, typecheck,
Lighthouse, Playwright, serwery artefaktu). Skopiuj je do własnego katalogu roboczego (scratchpadu) i wywołuj
stamtąd — blokada `.heavy-lock` powstaje obok skryptów.

| Skrypt                             | Do czego                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heavy.sh <polecenie...>`          | Mutex: czeka na blokadę, wykonuje polecenie, zwalnia blokadę (sprząta osieroconą blokadę po martwym PID).                                                                           |
| `heavy-bg.sh <log> <polecenie...>` | To samo w tle: wraca od razu, kod wyjścia trafia do `<log>.exit`. Nigdy `bash -c` jako polecenie.                                                                                   |
| `wait-for.sh <plik> [limit_s]`     | Czeka do 9 min na `<log>.exit`; kod 124 = nadal trwa (wywołaj ponownie).                                                                                                            |
| `light.sh <polecenie...>`          | Kroki lekkie (vitest plików, eslint, verify:static) poza mutexem, ale czekają, aż skończy się pomiar (Lighthouse/Playwright), żeby nie zaburzać czasów. Kod 75 = pomiar nadal trwa. |
| `typecheck-noinc.sh <worktree>`    | Typecheck jak `bun run typecheck`, bez współdzielonego tsBuildInfo (w worktree z dowiązanym `node_modules` zwykły typecheck kończy się OOM). Uruchamiaj przez `heavy-bg.sh`.        |

Lighthouse CLI dla `scripts/performance/lighthouse-local.mjs`: `npm i --prefix <scratch>/tools lighthouse@13.5.0`,
potem `LIGHTHOUSE_CLI=<scratch>/tools/node_modules/lighthouse/cli/index.js CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
