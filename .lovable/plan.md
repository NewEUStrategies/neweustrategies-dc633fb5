## Cel

Rozszerzyć pasek "Na czasie / Trending" w headerze o kolory (dark/light), tryb mieszany źródeł, tłumaczenia labelu, wielowariantowość (max 5) oraz animowaną ikonę ognia.

## Zakres zmian

### 1. Model danych (`src/lib/views/headerTickerQuery.ts`)

Rozszerzyć `TickerConfig`:
- `labelPl?: string` / `labelEn?: string` — nadpisania domyślnego "Na czasie" / "Trending"
- `colors?: { light: TickerColors; dark: TickerColors }` gdzie `TickerColors = { bg, border, label, item, itemHover, counter, divider }`
- `iconAnimation?: "none" | "pulse" | "flicker" | "spin"` (domyślnie `flicker`)
- Dodać `source: "mixed"` — pinned na początku + uzupełnienie do `limit` z `trending` lub `latest` (podkonfiguracja `mixedFill?: "trending" | "latest"`)

Nowy typ nadrzędny:
```ts
interface TickerVariant { id: string; name: string; config: TickerConfig }
interface TickerSettings { activeVariantId: string; variants: TickerVariant[] } // max 5
```

Zapis w `site_settings.header.trending` — migracja odczytu: jeśli stara struktura (płaskie pola), owinąć w pojedynczy wariant "Domyślny".

### 2. Server functions (`src/lib/views/postViews.functions.ts`)

- `getTickerPosts`: nowe źródło `"mixed"` z parametrami `pinnedPostId`, `selectedPostIds`, `mixedFill`, `limit`, `days`. Logika: pobierz przypięte + posortowaną resztę (trending RPC lub latest), zdedupliku, obetnij do `limit`.
- Rozszerzyć schemat Zod.

### 3. Komponent (`src/components/header/TrendingTicker.tsx`)

- Przyjmuje pełny `TickerConfig` (rozpakowany z aktywnego wariantu w `Header.tsx`).
- Renderuje CSS custom properties z `colors.light/dark` scoped do `.cms-trending` (`--tt-bg`, `--tt-label`, `--tt-item`, ...); dark mode przez `.dark .cms-trending { --tt-bg: ... }`.
- Label: `labelPl`/`labelEn` z fallbackiem do "Na czasie" / "Trending".
- Ikona `Flame`: klasa `tt-icon-<animation>` z keyframes (flicker: opacity+scale+skew; pulse: skala; spin: rotacja). Respekt `prefers-reduced-motion`.

### 4. Admin UI (`src/components/admin/TrendingTickerPane.tsx`)

Sekcje:
- **Warianty**: lista chip'ów (max 5), przyciski „+ Dodaj", „Zmień nazwę", „Duplikuj", „Usuń", radio „Aktywny wariant".
- **Źródło**: dodane `mixed` z wyborem `mixedFill` (najczęściej czytane / najnowsze).
- **Etykieta**: dwa inputy `labelPl`, `labelEn` z placeholderami defaultów.
- **Kolory**: dwie kolumny (Light / Dark), każdy z color pickerami dla `bg`, `border`, `label`, `item`, `itemHover`, `counter`, `divider`. Reset do defaultu.
- **Ikona ognia**: select animacji (none/pulse/flicker/spin) + live podgląd.
- Wszystkie zmiany działają na aktywnym wariancie; „Zapisz" pisze całą strukturę `TickerSettings`.

### 5. Wiring (`src/components/Header.tsx`)

- Odczyt `settings.header.trending` — jeśli nowa struktura, wybierz `activeVariant.config`; jeśli stara, zaadaptuj.
- Przekaż komplet propsów do `<TrendingTicker/>`.

### 6. i18n

Klucze `header.trending.defaultLabel` (PL: „Na czasie", EN: „Trending") — używane tylko gdy edytor nie ustawił własnych `labelPl`/`labelEn`. Klucze admina w `admin.ticker.*`.

### 7. Testy

- Unit dla `resolveTickerSource` + nowego `"mixed"` scenariusza.
- Test snap dla defaultowych kolorów CSS var output.
- Rozszerzenie `lang-parity.test.ts` o obecność labelu w obu językach.

## Szczegóły techniczne

- Domyślne kolory: `bg = hsl(var(--muted)/0.3)`, `label = hsl(var(--brand))`, `item = hsl(var(--foreground))`, `itemHover = hsl(var(--brand))`, `divider/border = hsl(var(--border))`, `counter = hsl(var(--muted-foreground))`. W dark to samo — semantyczne tokeny same się przełączają, ale edytor może nadpisać per-mode konkretnym `oklch()`/hex.
- Klasa scope: `.cms-trending[data-variant-id="<id>"]` + `html.dark .cms-trending[data-variant-id="<id>"]` dla nadpisania w dark.
- Migracja wstecz w runtime (bez SQL) — struktura settings jest JSON-em.
- Zachować `TICKER_TTL_MS` cache; klucz cache uwzględni nowy `mixedFill` i `variantId`.
- `visibleCount` badge nie wraca (usunięte wcześniej).
- Brak `any`; wszędzie typy; PL/EN teksty w admin przez `useTranslation`.

## Pliki

Edycja:
- `src/lib/views/headerTickerQuery.ts`
- `src/lib/views/postViews.functions.ts`
- `src/components/header/TrendingTicker.tsx`
- `src/components/admin/TrendingTickerPane.tsx`
- `src/components/Header.tsx`
- `src/i18n/*` (PL/EN)
- `src/__tests__/lang-parity.test.ts`

Nowe:
- `src/lib/views/tickerVariants.ts` — typy `TickerVariant`, `TickerSettings`, `DEFAULT_TICKER_COLORS`, migrator `normalizeTickerSettings(raw)`.
- `src/components/header/__tests__/tickerVariants.test.ts`
