# Verdict: hydration / H5 — "Stop full-document restyle and forced layout from Header measurements"

Reviewer: adversarial (Opus). Code read-only. Evidence dir: `verdicts/hydration-H5/` (probe.mjs, probe2/3.mjs, trace-h5.mjs, runs/A-_, B-_, C-*, *-inv, lh/).

## Lens 1 — feasibility / correctness: REFUTED

### (a) `@property --sticky-header-h { inherits:false }` does NOT remove the 874-element recalc on this page

- Synthetic page (probe.mjs): registered non-inherited var -> ULT 1 element (vs 204 unregistered). So the mechanism works _in isolation_.
- Real fixture page (probe2/probe3.mjs, after hydration, 1x): **any** computed-style change on `<html>` recalcs the whole document, with or without the `@property` registration:
  - `--sticky-header-h` +3px: A 926 el / B (registered) 918 el
  - `html.style.scrollPaddingTop = 150px` (plain non-inherited property): 926 / 918 el
  - `<style>html{scroll-padding-top:Npx}</style>` text change: 918 el
  - `body` inline var: 913 el. Only a no-match attribute on html (`data-zz`) costs 1 element.
- 4x CDP traces with the H5(a) CSS injected into the document (trace-h5.mjs --inject, registration verified: body sees 96px, html 107px):
  B-1 ULT **874 el 268 ms**, B-2 **874 el 212 ms**, B-inv **882 el 345 ms**, invalidation still "Inline CSS style declaration was mutated" on HTML, stack `S` index 422:14673 (= Header.tsx:566).
  A (baseline) 874 el 240-312 ms. So (a) as specified saves ~0.
- Control C (setProperty('--sticky-header-h') on html suppressed by an injected head script): the 874-el recalc **disappears** (C-1/C-2: no ULT > 59 el besides the unrelated 564-el animation/refetch frame). The cost is "writing html's style at load", not inheritance of this variable.

### (a) also changes anchor offsets (risk note says they must stay identical)

- Today `html{scroll-padding-top}` (styles.css:6678-6680) and `[id]{scroll-margin-top}` (styles.css:6681-6683) **add up** in Chromium: probe.mjs scrollIntoView/fragment target lands at 254 px = 127 + 127. Making `[id]` not read the variable halves native anchor offsets (127 px) for TanStack hash navigation (`router-core/.../scroll-restoration.js:184` `scrollIntoView`) and for `scrollIntoView({block:'start'})` callers (ClubHubHero.tsx:241, EventAgendaBoardView.tsx:122, ExpertMaterialsExplorer.tsx:106). [id] targets inside inner scrollers lose their margin entirely. JS paths with explicit offsets (smoothScrollToAnchor.ts:138/170, TocWidget.tsx:145 `-96`, footnotes/navigation.ts:24 `-112`) are unaffected. No e2e test guards anchor offsets (grep e2e: none), so the listed "e2e anchor/scroll tests" gate does not exist.

### (b) "forced layout 138 ms from getBoundingClientRect at mount" is misattributed

- Forced recalcs with JS stacks inside the root hydration task (lha1-mobile observed trace, m4-ok-1, v-full-1, A/B/C runs): the only one with a `Layout` is at index 422:14025, which is **`document.fonts?.ready`** (Header.tsx:516), not getBoundingClientRect. Blink's `FontFaceSetDocument::ready()` runs `UpdateStyleAndLayout` synchronously when `ready` is already resolved. It flushes the header subtree (56-59 elements, 7 dirty layout objects) that `measure()` just dirtied with `--hdr-*`/`data-metrics` writes (stack 422:13541). Cost: 3-14 ms at 4x (41+5 ms only under invalidation tracking), 3 ms at 1x. The mount `getBoundingClientRect` reads (E@422:13165, S@422:14605) cost 0.1-0.3 ms (el=1).
- The "138 ms inclusive function S" is inclusive time of the effect, not avoidable layout. Moving the read into an RO callback relocates the work to the next frame.
- Tests: Header.test.tsx:1316-1324 and :1427-1437 assert that `--sticky-header-h` = 212px **synchronously at mount**, without firing RO. `ControlledResizeObserver.fire()` (:430-432) passes `[]` entries, so code that reads `entries[0].borderBoxSize` needs a test-double rewrite as well.
- No SSR/hydration-parity, chunk-graph, bundle, entry-purity or loader-policy impact. noHasSelectors and cssLayers are unaffected (an unlayered `@property` already exists at styles.css:6474).

## Lens 2 — effect realism: REFUTED (as specified); the real target is ~20-30 ms mobile

### Lantern arithmetic (LH 13.5 trace_engine, Simulator.js:239: tasks that contain a `Layout` use mult x 0.5)

- Observed LH mobile trace (`lighthouse-analyst/artifacts/lha1-mobile/trace.json`):
  - The post-hydration frame task is 776 ms + 40.4 ms (ULT 781 el 37 ms, Layout 0.2 ms, then RO callbacks k@422:13648 / A@422:14766). Because it contains a Layout, it is simulated at x2 = **81 ms**, the `index-DPN2YAij.js@6606+81` long task. Its TBT share is 81 − 50 = **31 ms**, not 90-180.
  - baseline2 index-attributed tasks: 119/69/68 ms simulated -> 69/19/18 ms TBT (if they are the same frame).
- The 137-177 ms "at 4x" numbers come from CDP DevTools throttling. Lantern does not score that, and it halves this task.
- Desktop (`lha1-desktop`): 749 ms + 35.1 ms (892 el), mult 1 x 0.5 = 17.5 ms simulated -> **0 TBT**. On a PSI host ~3x slower: ~105 x 0.5 = 53 -> ~3 ms. With the sandbox planning rule (desktop at mult 4 -> layout x2): 70 -> 20 ms. So **0-20 ms**, not 20-45.
- Score: mobile −20..−30 ms TBT ≈ +0.5..+0.8 pts (analyst slope −100 ms ≈ +2.5); desktop ≈ 0..+0.4.

### (b) is likely NEGATIVE under Lantern

- The root hydration task (680 ms + 95.6 ms observed) contains exactly one Layout, the one forced by `document.fonts.ready` after measure()'s writes. That Layout is why Lantern simulates the task at x2: `vendor-react@6415+191` = 95.6 x 2.
- If (b) removes the sync mount writes and therefore that Layout (its stated goal is "no forced layout runs inside the hydration commit"), the task becomes x4 = 382 ms. Mobile TBT rises by about **+190 ms**.
- On desktop it goes from 45.5 to 91 ms simulated (+41 ms TBT on the sandbox; ~+136 ms on a 3x slower PSI host).
- This is a Lantern artifact, but it is what gets scored. Do not ship (b). Flag it to every workstream: removing the last Layout from the big hydration task doubles its scored cost.

### What-if run (canonical harness)

- `lighthouse-local.mjs --compare . . --html-transform-b h5a-transform.mjs --runs 2 --forms mobile`: DELTA TBT +6 ms, score ±0.
- A TBT 199/302, B 288/225. That is noise-dominated (A/A ±464 ms), but consistent with "no effect": the 4x CDP traces show the recalc survives the transform.

## Better alternative (same intent, cheaper, actually works)

Do not change `<html>`'s computed style during load:

1. Skip the mount publication when the measured height is within ~16 px of the CSS default. Initialise `last` from the CSS fallback, and set the per-breakpoint defaults to the real header heights (fixture mobile 107 px).
2. Or drop the runtime variable altogether: constant per-breakpoint `scroll-padding-top` on html, and remove the duplicated `[id]` scroll-margin. JS anchor paths already measure the header live.

Publish on real resize/settle only. Leave `measure()` and `document.fonts.ready` alone, so the hydration task keeps its Layout under Lantern.
Expected: mobile −16..−31 ms TBT (≈ +0.4..+0.8 pts), desktop 0..−20 ms, 4x-CDP style work −150..−340 ms (C runs). Effort XS (Header.tsx:548-585, styles.css:6678-6683, Header.test.tsx:1316-1324/1427-1471). The halved anchor offset needs an explicit product decision, not an "identical" claim.
