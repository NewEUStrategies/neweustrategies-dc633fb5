# Verdict LA-C1: main-thread task-length program + CI gate

Reviewer: adversarial (Opus). Repo is read-only, nothing in it was edited.
Work files: `verdicts/LA-C1-work/split.py` (a what-if that splits tasks and keeps their CPU) and `src-*` (edited trace dirs). The what-if runs reuse the analyst's `whatif.py`/`audit.mjs` with `WI_SRC`; outputs are `wi/tmp-rev_LAC1_*`.

## Lens 1: feasibility in this codebase. Verdict: WEAKENED

### 1. "Make React yield" is already done. TBT comes from a few synchronous tasks, not from 180 slices.

- The client entry is TanStack's default `node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx`. It wraps `hydrateRoot` in `startTransition` (lines 5-12), so hydration already renders time-sliced. That is why the trace shows about 169 small `vendor-react` slices.
- `tasks.py artifacts/lha1-mobile 12 4` lists the post-FCP tasks over 12 ms (obs ms):

  | task                                           | obs ms                    |
  | ---------------------------------------------- | ------------------------- |
  | `_t` vendor-react, commit with Layout          | 95.6                      |
  | root pass (RunMicrotasks 27.4)                 | 34.3                      |
  | style recalcs (UpdateLayoutTree 37.0 and 31.5) | 40.5, 40.4, 32.4          |
  | "other"                                        | 35.5                      |
  | React FunctionCall that contains ParseHTML     | 37.3                      |
  | timer                                          | 23.5                      |
  | GC                                             | 17.6                      |
  | other React tasks                              | 22.4, 18.5, 14.8          |
  | React slices just over 12 ms                   | 12.9–13.9, only 6 of them |

- So the claim "180 slices of 9–14 ms sit right at the threshold" (LA-F3) does not describe the TBT at ×4. Only the 6 slices over 12.5 ms count, and together they add about 20 ms. The rest of the TBT is a handful of synchronous tasks.

### 2. React cannot time-slice a commit.

- The 95.6 ms task is a single commit, and a commit always runs synchronously. Dehydrated boundaries that are retried in the same lane can commit together.
- Splitting it therefore takes the hydration workstream's island gate (`phase1/hydration.md` §H7): islands that suspend on the client and are released one at a time.
- The hydration report's open question #1 (why is the root pass one 361 ms@4× task inside `startTransition`?) is still unresolved. Nobody has yet identified what forces Layout inside that commit; it needs a React profiling build.

### 3. Hazards in the island and deferral part

- **Updates reaching a dehydrated island.**
  - A Default or Sync update makes React client-render the island. The SSR HTML is lost and the `null` public fallback shows (`lazySuspense.tsx` `LazyFallback`), which means CLS. CLS is 25 points that are currently banked.
  - A transition (ThemeProvider `startTransition`, `ThemeProvider.tsx:126`; device switch `BuilderRenderer.tsx:255-258`) waits until the island hydrates. With an interaction or IntersectionObserver trigger, that wait has no upper bound.
  - The fixture cannot show any of this, because Supabase fails fast and no refetch rerender happens (EVIDENCE §0-cloud). Verification needs the in-process backend that the hydration workstream used.
- **Mega menus.** Deferring their hydration contradicts the rule in `lazyWidgets.tsx:35-36`: "navigation must hydrate first (header interactivity)".
- **Device-switch `<style>` swaps.** The swaps follow from the parity design: SSR renders desktop first and the client corrects afterwards (`BuilderRenderer.tsx:238-242`). Fixing them at the root must not add `Vary` on UA or client hints to the edge-cached document. That would split the cache key and lower the HIT ratio, which costs SI and TTFB.
- **New Suspense boundaries around header or footer.** A lazy component or query that suspends on the server pushes the header HTML to the end of the stream (the trap documented in `lazyWidgets.tsx:50-58`). That would regress FCP and LCP.
- **Logged-in users and editors.** Builder canvas mode (`useBuilderMode`) must bypass the deferral.
- **Field INP.** INP is not part of the LH score, but it is a CrUX Core Web Vital, and deferring work to the first interaction worsens it.

### 4. The proposed gate is mis-specified.

- `scripts/performance/firstVisitMainThread.ts:28` uses `PerformanceObserver({type:"longtask"})`, which only reports tasks of 50 ms or more.
- With CDP throttle ×4, observed durations are already ×4, so `4·dur−50` scales twice.
- Without throttling, the observer never sees the 12.5–50 ms tasks that the change is about.
- Real CDP throttling also differs from Lantern. React yields on wall-clock time (about 5 ms), so a throttled run produces shorter sliced tasks than "×4 of the unthrottled task". The gate would then pass code that Lantern still penalises.
- No CPU throttling exists in `e2e-performance` today (grep finds no `setCPUThrottlingRate`). An absolute threshold on a shared `ubuntu-latest` runner (`.github/workflows/first-visit.yml`) would be flaky.
- Correct gate: either the Lantern formula over all top-level tasks from an unthrottled trace (×4, layout tasks ×2, as `tasks.py` already does), or LHCI. `lighthouserc.json` already gates TBT; add a desktop collection with `throttling.cpuSlowdownMultiplier=4`, plus mobile with simulated throttling.

### 5. The analyst's evidence overstates the mechanism.

- `whatif.py:136-156` `cap` truncates each task, scaling it to f = cap/dur and deleting the CPU above the cap. The report says "total CPU unchanged", and that is false.
- `P_post50`/`P_cap12` apply to every post-FCP task: parse, style, GC, timers, and the consent/radix/sonner chunks. They are not limited to the React and style code that LA-C1 changes.
- They are also single-trace what-ifs, while the fixture's TBT varies widely between runs (558–991 ms in baseline2 per `hydration.md`).

### Gates

- `check:chunks`, `check:entry-purity`, `check:bundle` and `noHasSelectors`: low risk if the gate helper is kept out of `lazySuspense.tsx`. That file is declared pure glue ("no widget logic", lines 13-15).
- `setTimeout(0)` stays as is (`router.tsx:210`, confirmed).

## Lens 2: effect realism. Verdict: WEAKENED

### What-ifs that split tasks and keep their CPU (fixture, h2 + 38 KB hero parity)

| scenario                                                          | mobile ×4 TBT (base 356) | desktop @×4 TBT (base 444) | desktop @×5 TBT (base 765) |
| ----------------------------------------------------------------- | ------------------------ | -------------------------- | -------------------------- |
| every post-FCP task ≤12 ms obs (ceiling, more than LA-C1 touches) | 0                        | 44                         | 129                        |
| React ≤12 + style recalcs >20 ms removed (most LA-C1 can do)      | 22                       | 150                        | 297                        |
| React ≤16 + style removed                                         | 93                       | 290                        | —                          |
| React ≤20 + style removed                                         | 187                      | 332                        | —                          |
| style recalcs removed only                                        | 306                      | 434                        | —                          |
| mobile ×6 (PSI host 1.5× slower), React ≤12 + style               | 217                      | —                          | —                          |

- Desktop is very sensitive to the cap: ≤12 gives 160 and ≤16 gives 290. The ≤110 target on the proxy is reached only if non-React tasks are capped as well.
- The analyst's own model puts the PSI desktop host at about ×5 of the sandbox. At ×5 a 12 ms piece becomes 60 ms simulated and blocks again.

### PSI projection, using the analyst's own TBT split

- **Mobile.** PSI mobile is 600 ms: hydration 55–65 %, gtag 20–30 %, consent about 10 %. Removing 74–94 % of the hydration and style share gives TBT 240–360 ms, a score of **60–64** (+7 to +11). With a realistic ≤20 ms commit split it is about 430 ms, a score of 57. The claim was 66.
- **Desktop.** PSI desktop is 740 ms. The in-scope part goes from 444 to 150–290 on the ×4 proxy. Production adds about 300 ms that LA-C1 does not touch (gtag, consent, refetch, 25 % more DOM). That gives about 450–590 ms. The ×5 calibration gives about 300 ms plus gtag. The range is **300–590 ms, a score of 73–84 (+3 to +14), not 95.** For comparison, the hydration workstream estimates 250–350 ms from its own work.
- **What reaching 95 on desktop needs:** LA-C1, plus LA-2 (gtag and consent out of the window), plus capping or deferring non-React tasks.
- **Where the biggest real gain comes from:** removing hydration CPU from the LH trace, i.e. islands deferred to interaction, plus the consent shell and overlays deferred to interaction. Making the yield granularity finer helps far less.
- **A cheaper first step with large leverage:** find what forces Layout in the 95.6 ms commit and the 34 ms root pass (worth about 141 + 87 latent blocking ms), and fix the device-switch style swap. Do this before building a general yielding framework.
