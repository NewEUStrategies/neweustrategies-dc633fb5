# Nowa kolejność sekcji pod overlay cover

Kolejność pod overlay-em okładki dla wpisów tekstowych:

```text
[Overlay cover + tytuł]
  │
  ▼
1. Key Takeaways ("Dowiesz się…")         ← już wdrożone
2. Odsłuch materiału (ElevenLabs TTS)     ← NOWE, publiczne
3. Spis treści in-body (opcjonalny)       ← NOWE, off by default
4. Treść wpisu (ContentRenderer)
```

Sidebar-owy ToC po prawej stronie zostaje bez zmian (domyślny sposób pokazywania ToC).

## Zakres

### 1. ElevenLabs - podpięcie connectora + publiczny endpoint TTS
- Zlinkuj istniejący connector `elevenlabs` do projektu (secret `ELEVENLABS_API_KEY` server-side).
- Nowy publiczny endpoint `src/routes/api/public/post-tts.ts`:
  - `POST { postId, lang }` - bez wymogu roli staff (obecny `/api/tts` jest tylko staff).
  - Ładuje tekst z DB przez `supabaseAdmin` (server-only), buduje bezpieczny `plain text` z `blocks_data`/`content_pl|en` (bez HTML), obcina do 5000 znaków.
  - Rate-limit per IP + per postId (reużyj `rateLimit` z `src/lib/server/rate-limit.server.ts`).
  - Cache: hash(text+voice+model) → jeśli w `storage` bucket `tts-cache` audio jest, oddaj signed URL (mniej palenia ElevenLabs). W v1 wystarczy zwrócić `audio/mpeg` binarnie z `Cache-Control: public, max-age=31536000, immutable`.
  - Voice/model whitelist (jak w istniejącym `/api/tts`).
- Wymuszona lokalizacja modelu: PL/EN → `eleven_multilingual_v2`.

### 2. `PostListenBar` (nowy komponent)
- `src/components/post/PostListenBar.tsx` - premium przycisk "Posłuchaj artykułu · ~X min" + play/pause + progress + volume.
- Fetch strumienia z `/api/public/post-tts` przez `fetch().blob()` (zgodnie z `elevenlabs-tts`), odtwarzanie przez `HTMLAudioElement`.
- Estymacja czasu na podstawie `read_minutes` × 1.15 (audio jest wolniejsze niż czytanie).
- SSR-safe (żadnego `window` na module scope), i18n PL/EN, tokeny z design systemu.
- Widoczne tylko gdy `post_format ∈ {standard, gallery}` (nie audio/video - te mają własne playery).

### 3. Inline ToC pod przyciskiem odsłuchu
- Rozszerzenie `TocDefaults` o `showInBody: boolean` (default `false`) i `TocOverride.showInBody` (nullable).
  - `src/lib/toc/settings.ts` - zod schema + migracja (istniejące wartości bez pola dostają `false`, więc domyślnie tylko sidebar - zgodnie z zapisem: "by default zawsze widoczny w sidebarze po prawej").
- W `admin.toc.tsx` + `PostSettingsMetabox.tsx` toggle "Pokaż w treści (pod przyciskiem odsłuchu)" - per wpis nadpisanie globalu.
- W `src/routes/$.tsx` (contentBlock) renderuj `<TocBlockView>` na podstawie `mergeTocSettings(defaults, override).showInBody === true` oraz gdy `blocksDoc` daje ≥ `minHeadings` nagłówków. Sidebar ToC (jeżeli już istnieje) zostaje bez zmian.

### 4. Kolejność w `$.tsx` (contentBlock)
```tsx
{keyTakeawaysNode}              // 1
{listenBarNode}                 // 2 (jeśli tekstowy)
{inlineTocNode}                 // 3 (jeśli showInBody)
<ContentRenderer … />           // 4
<FootnotesList … />
```

## Bezpieczeństwo / rate-limit

- Endpoint publiczny → agresywny rate-limit (np. 3/min i 15/h per IP; per postId 30/h globalnie), zwrot 429 z `Retry-After`.
- Twarda whitelist voice/model, twardy limit `MAX_CHARS = 5000`.
- Brak logowania treści; log tylko `postId, lang, ip_hash, bytes`.
- CORS: same-origin.
- Response cache header + `ETag` z hashu treści.

## Pliki do zmiany / utworzenia

- **Zmiana**: `src/lib/toc/settings.ts`, `src/routes/admin.toc.tsx`, `src/components/admin/PostSettingsMetabox.tsx`, `src/routes/$.tsx`.
- **Nowe**:
  - `src/routes/api/public/post-tts.ts`
  - `src/components/post/PostListenBar.tsx`
  - `src/components/post/InlineToc.tsx` (adapter na `TocBlockView` biorący `blocksDoc` + settings).
- **i18n**: `src/lib/i18n-*.ts` (klucze `post.listen.*`, `post.toc.inline.*`).

## Poza zakresem (tej iteracji)

- Cache audio w Storage (możliwe później - v1 gra bez cachowania).
- Cross-linkowanie audio do playera w Reading List.
- Wariant "audio-only feed" (RSS podcast).

Zatwierdź, wtedy wdrażam.