# Verdict boot-js / C4 (lazy Supabase facade)

Feasibility: WEAKENED. Effect: WEAKENED.

## Lens 1: feasibility and correctness

Confirmed:

- The only boot edge into vendor-supabase is the entry's `import{c as e0}from"./vendor-supabase-Pf0Abwmk.js"`, which is `createClient`, from `src/integrations/supabase/client.ts:14`.
- No other boot chunk imports vendor-supabase: vendor-radix-boot imports only vendor-react.
- So a dynamic SDK import does take 224 170 B raw / 58 636 B transfer out of the boot closure.
- Guest detection already exists at `src/hooks/useAuth.tsx:107-121`.
- AuthProvider closes `loading` through `getSession()` (`useAuth.tsx:358`), so a facade that answers `{session:null}` keeps guests working.
- Realtime is user-gated at `CommentsSection.tsx:118` and `__root.tsx:161-205`, so by the time `supabase.channel(...)` is called synchronously, `real` exists.
- 786 test files mock `@/integrations/supabase/client`, so the export shape is preserved.

Blocking issues the spec misses:

1. **Implicit-flow URL sessions break.**
   - auth-js defaults to `flowType: 'implicit'` (`node_modules/@supabase/auth-js/dist/module/lib/constants.js:21`).
   - `client.ts:35-39` keeps `detectSessionInUrl` at its default of true.
   - Magic links (`emailRedirectTo` to arbitrary pages: `ClubAccessGate.tsx:323`, `GuestCheckoutGate.tsx:89`, `PopupSignupForm.tsx:309`, `LoginPopup.tsx:175`), OAuth (`AuthFormBlocks.tsx:481,883`) and password recovery (`AuthFormBlocks.tsx:1109-1114`, which waits for `PASSWORD_RECOVERY` from the SDK) all land with tokens in `location.hash` and nothing in storage.
   - The facade's guest path then resolves `getSession()` to null and queues the listeners forever. The result: the reset-password form is stuck on "no token", and magic-link and OAuth logins never take effect.
   - Fix: `wantsFull()` must also return true when the URL hash or search contains `access_token`, `refresh_token`, `error_description`, `code` or `type=`.
2. **`vite.config.ts` is not in the file list, but `vite.config.ts:353` sends every `/node_modules/@supabase/` module to vendor-supabase.**
   - `import("@supabase/postgrest-js")` therefore resolves to the full 224 KB chunk, not to the "~8 KB gz postgrest chunk".
   - A `vendor-postgrest` manualChunk is needed, and `check:chunks` must be re-run on it.
3. **The tslib edge.**
   - tslib was placed inside vendor-supabase. The inventory lists its module, and the chunk exports `_ ,a, b`.
   - `vendor-radix-CIuvgUd0.js` statically imports `{_ as Ee,a as Wo,b as zi}` from vendor-supabase.
   - On guest pages vendor-radix loads post-boot (prod 3881 ms), so the SDK is still downloaded and evaluated. The verification step "guest page load: no vendor-supabase request" fails unless tslib gets its own chunk (or C8 removes radix for guests).
   - `dispatch.functions` also imports createClient through a leaked `client.server.ts`, but it is admin-only.
4. **The chain recorder must be mutable and return the same object.**
   - `src/lib/admin/community.ts:124` calls `query.ilike(...)` without reassigning the result.
   - An immutable recorder would silently drop that filter.
5. **The SSR branch must not leave a static `@supabase/supabase-js` import in `client.ts`.**
   - auth-js, postgrest-js and realtime-js have no `sideEffects:false`, so Rollup would keep the side-effect import, and the edge would survive in the client build.
   - Use a `.server`-resolved module or `createIsomorphicFn`.
6. **Listener ordering when an SDK-less guest signs in.**
   - If `INITIAL_SESSION` arrives with the new user, `useAuth.tsx:323-328` treats it as the starting identity and skips `reauthorizeContent`.
   - Needs a replay test, which the spec already lists.

None of these is fatal. All of them can be fixed, but the file list and the effort estimate (M) understate the work.

## Lens 2: effect, from the deterministic Lantern what-if

The what-ifs were run with `lighthouse-analyst/whatif.py` on lha1 artifacts with h2 parity. "Realistic CPU" means `shrinkurl:vendor-supabase:0.85`, which removes about 29 ms of observed CPU. That roughly matches the bootup-time scripting of 87-152 ms simulated at ×4, i.e. 22-38 ms observed.

| run                              | FCP         | LCP         | TBT                                 | SI          | perf        |
| -------------------------------- | ----------- | ----------- | ----------------------------------- | ----------- | ----------- |
| mobile base                      | 3974        | 4819        | 356                                 | 3974        | 65          |
| mobile, drop SDK bytes           | 3823 (-151) | 4518 (-301) | 363 (+7)                            | 3823        | 67          |
| mobile, bytes + realistic CPU    | 3823        | 4518        | 349 (-7)                            | 3823        | 67          |
| desktop ×1                       | 773 → 733   | 933 → 893   | 0                                   | 733         | 99 → 99     |
| desktop ×4 (PSI proxy)           | 770 → 730   | 913 → 853   | 444 → 499 bytes-only / 457 with CPU | 951 → 865   | 79 → 77..79 |
| with C3 (dropscripts-before-lcp) | 1367        | 2117        | 885 → 829                           | 1952 → 1936 | 78 → 79     |

How the numbers compare with the claim:

- **FCP and SI.** The claimed "FCP/LCP/SI −0.3 s" holds for LCP only. FCP is −0.15 s (about 2.7 ms/KB × 55 KB: the chunk drains in parallel). SI is −0.15 s on the fixture, where SI is clamped to FCP. On PSI it is about 0, because SI = max(FCP, 1.4·obsSI + 0.4·layoutSI) and the unthrottled obsSI barely moves.
- **TBT.** The "bootup −57..−130 ms" figure is not TBT. Removing about 29 ms of observed CPU nets TBT about 0 (−7 ms mobile). The earlier FCP pulls tasks into the window: TBT +7 ms mobile and +55 ms on desktop ×4 from bytes alone.
- **PSI LCP.** The analyst (§5.3) infers PSI's observed LCP comes after DCL, so the post-boot wave is inside the LCP set. vendor-radix still pulls vendor-supabase (issue 3), and the first PostgREST query pulls it too (issue 2). So on PSI, the LCP saving is between 0 and −0.3 s.

Corrected estimate:

- **Mobile:** +1 to +2 points standalone.
  - Fixture: 65 → 67.
  - PSI: FCP −0.15 s gives about +0.5 point; LCP −0..−0.3 s at 6.6 s gives about +0..+0.7 point.
- **Desktop:** 0 points (range −2 to 0 on the ×4 proxy).
- **TBT:** about 0 ± 15 ms.
- **With C3:** the bytes no longer matter, and the gain is about +1 mobile (TBT −56 ms).
- The figure "boot −58.4 KB gz" holds only after issues 2 and 3 are fixed. Without those fixes the boot bytes are still removed, but guests still download the SDK post-boot.

Cheaper alternative with the same score effect: drop the postgrest-only path.

- Lazy-load the full SDK on the first `from`/`rpc`/`auth` call, plus the guest `getSession`/`onAuthStateChange` short-circuit and the URL-token check.
- Pre-FCP bytes are identical, and the GoTrue CPU it would additionally save is worth about 0 TBT.
- It avoids the header-parity and second-client risk.
- Per KB, C5 (the dictionary split, −26 KB, what-if FCP −300 / LCP −151) is the better-value byte cut.
