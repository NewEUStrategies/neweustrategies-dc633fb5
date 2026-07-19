
# Plan: Pełne pokrycie i18n PL/EN

Duży zakres — dzielę na 4 fazy uruchamiane sekwencyjnie w tym samym cyklu, każda kończona type-check + testem parity kluczy.

## Faza 0 — Fundament (raz)

1. Dodać `src/lib/__tests__/i18n-key-parity.test.ts` — statyczny audyt `src/lib/locale/pl.ts` vs `en.ts`: rekurencyjne porównanie zestawów kluczy; brak klucza po jednej stronie = fail. To zabezpieczy nas przed regresją przy dokładaniu tłumaczeń.
2. Dodać do samego audytu opcjonalną drugą asercję: żaden klucz PL nie może być identyczny stringiem jak EN (poza whitelist: nazwy własne, akronimy). Pomaga wychwycić „pl skopiowany do en".
3. Skan hardkodowanych PL stringów w wybranych plikach (`rg -n "[ĄĆĘŁŃÓŚŹŻąćęłńóśźż]"`) — lista do rozbicia po fazach.

## Faza 1 — Czat

Pliki: `DemoBotChat.tsx`, `DemoBotListItem.tsx`, `MessageList.tsx`, `MessageBubble.tsx`, `ChatBell.tsx`, `MediaHistoryDialog.tsx`, `AttachmentPreview.tsx`, `ImageLightbox.tsx`, `PdfPreviewDialog.tsx`, `ChatMediaPanel.tsx`, `ConsentsPanel.tsx`.

Namespace: `chat.*` (istnieje częściowo). Uzupełnić:
- `chat.composer.placeholder`, `chat.composer.attach`, `chat.composer.send`, `chat.composer.emoji`, `chat.composer.stop`.
- `chat.bubble.copy|reply|forward|delete|report|edit|react`.
- `chat.demoBot.title|subtitle|welcome|typing|quickReplies.*`.
- `chat.media.tabs.{all,images,files,links}`, `chat.media.empty`, `chat.media.open`, `chat.media.download`.
- `chat.attachment.preview`, `chat.attachment.download`, `chat.attachment.pdfPage`, `chat.attachment.lightboxClose|prev|next`.
- `chat.bell.empty.{title,cta}`, `chat.bell.markAllRead`.
- `chat.consents.*` (jeśli hardkody).

Podstawić `t(...)` w miejscach hardkodów.

## Faza 2 — Wyszukiwarka

Pliki: `SearchButtonWidget.tsx`, `SearchAutosuggest.tsx`, `PeopleOrgResults.tsx`, `AdvancedSearchPanel.tsx`, `SearchSectionTabs.tsx`, `routes/search.tsx`, `DatePicker` opisy.

Namespace: `search.*`. Uzupełnić:
- `search.placeholder`, `search.button`, `search.advanced`, `search.viewAll`, `search.recent`, `search.empty.{title,hint}`.
- `search.tabs.{all,articles,people,organizations,topics}` + `search.tabs.tooltips.*`.
- `search.operators.{and,or,not,exact,site,description}`.
- `search.filters.{dateFrom,dateTo,contentType,topic,author,organization,clearAll,apply}`.
- `search.people.{followers,connect,message,verified}`, `search.org.{website,members}`.

## Faza 3 — Profil i sieć

Pliki: `routes/profile.index.tsx` (guest preview action bar), `network/*` (`ProfileViewsCard`, `RequestIntroductionButton/Dialog`, `ReportUserDialog`, `MutualConnectionsHint`, `DossierFollowers`, `EventGroupButton`), `InterestsCustomizer.tsx`, moduły endorsements/recommendations.

Namespace: `profile.*`, `network.*`. Uzupełnić:
- `profile.guest.{title,exit,addToNetwork,message,follow,report}`.
- `network.recommendations.{title,write,received,given,empty}`.
- `network.endorsements.{title,endorse,thanks,skills,empty}`.
- `network.introductions.{title,request,accept,decline,pending,intro,message}`.
- `network.views.{title,thisWeek,thisMonth,anonymous,empty}`.
- `network.report.{title,reason.*,submit}` i `network.block.{action,confirm}`.

## Faza 4 — Admin Panel

Zakres: `admin.settings.*`, `admin.pages.*`, `admin.newsletter.*`, `admin.ads.*`, `admin.categories.*`, `admin.events.*`, `admin.community.*`, `admin.users.*`, `DesignSubNav`, `AdminLangBar`, `PageParentSelect`, `CustomMetaValuesEditor`.

Namespace: głównie istniejący `admin.*` — uzupełnienie brakujących kluczy w formularzach (labels, placeholders, akcje, konfirmacje), tooltipów i komunikatów toast. Wymienić hardkodowane PL na `t(...)` z fallbackiem EN.

## Weryfikacja

Po każdej fazie:
1. `bunx vitest run src/lib/__tests__/i18n-key-parity.test.ts` — brak brakujących kluczy.
2. `bunx tsgo` na zmienionych plikach.
3. Playwright smoke: `/messages`, `/search?q=igor`, `/profile`, `/admin/settings/general` w PL i EN — screenshoty do potwierdzenia braku hardkodów.

## Uwagi techniczne

- Klucze płaskie z kropkami, spójne z istniejącą konwencją `src/lib/locale/pl.ts`.
- Interpolacje z i18next (`{{count}}`, plural one/few/many po polsku — mamy już infrastrukturę w `pluralization.test.ts`).
- Nigdy `any`, myślnik `-` zamiast `—`, atomic design zachowany (komponenty nie zmieniają struktury, tylko copy).
- Zmiany wyłącznie prezentacyjne — brak modyfikacji logiki biznesowej ani schematu bazy.

Skala: ~40 plików, ~250 nowych kluczy. To 4 osobne, znaczące iteracje. Proponuję zatwierdzić plan i uruchomić Fazy 1-4 kolejno w tym cyklu (każda z własnym raportem), albo wybrać jedną fazę na start.
