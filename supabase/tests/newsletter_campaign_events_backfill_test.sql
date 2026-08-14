-- pgTAP: odkażenie danych zastanych w migracji 20260814150000 - kasowanie
-- duplikatów ORAZ przeliczenie scoringu leadów, których te duplikaty dotyczyły.
--
-- PO CO OSOBNY PLIK. `newsletter_campaign_events_dedup_test.sql` dowodzi
-- INWARIANTU (indeks + RPC) na bazie, w której duplikatów już nie ma. Tu
-- dowodzimy czegoś innego i trudniejszego: że jednorazowy backfill naprawia
-- bazę, która duplikaty MA. Żeby taki stan w ogóle odtworzyć, trzeba w obrębie
-- transakcji zdjąć indeks unikalny - inaczej nie da się wstawić wiersza, który
-- migracja ma posprzątać.
--
-- CZEGO PILNUJE. `trg_score_on_campaign_event` jest AFTER INSERT, więc DELETE
-- go NIE odpala, a `crm_leads.score`, `score_band` i `score_breakdown` są
-- ZMATERIALIZOWANE. Bez jawnego przeliczenia lead zostawał z wynikiem
-- policzonym z zdublowanych zdarzeń aż do następnego własnego sygnału - a lead
-- nieaktywny nie wygeneruje go nigdy i tkwiłby w zawyżonym paśmie bez końca.
-- Trigger jest tu CELOWO włączony: to on wytwarza zawyżony stan wyjściowy.

BEGIN;
SELECT plan(7);

ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name)
VALUES ('e1111111-1111-1111-1111-1111111111e1', 'nce-backfill', 'Backfill Tenant');

-- Jawne ustawienia scoringu: test ma być deterministyczny, a nie zależny od
-- tego, czy tenant dostał wiersz z triggera zasiewającego.
INSERT INTO public.crm_scoring_settings (tenant_id, enabled, half_life_days, horizon_days)
VALUES ('e1111111-1111-1111-1111-1111111111e1', true, 30, 365)
ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, half_life_days = 30, horizon_days = 365;

INSERT INTO public.newsletter_campaigns (id, tenant_id, name, subject_pl, subject_en, html_pl, html_en)
VALUES ('ea111111-1111-1111-1111-1111111111ea', 'e1111111-1111-1111-1111-1111111111e1',
        'Kampania', 'Temat', 'Subject', '<p>a</p>', '<p>a</p>');

INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status)
VALUES ('5e111111-1111-1111-1111-1111111111ee', 'e1111111-1111-1111-1111-1111111111e1',
        'backfill@x.test', 'subscribed');

INSERT INTO public.crm_leads (id, tenant_id, email_norm, email, first_name)
VALUES ('1e111111-1111-1111-1111-1111111111ee', 'e1111111-1111-1111-1111-1111111111e1',
        'backfill@x.test', 'backfill@x.test', 'Backfill');

-- ---------------------------------------------------------------------------
-- Stan sprzed migracji: piec otwarc tej samej doby (dwa producenty + wielokrotne
-- pobranie piksela). Indeks zdejmujemy, zeby ten stan w ogole dalo sie odtworzyc.
-- ---------------------------------------------------------------------------
DROP INDEX public.nl_campaign_events_subscriber_day_uq;

INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind, created_at)
SELECT 'e1111111-1111-1111-1111-1111111111e1', 'ea111111-1111-1111-1111-1111111111ea',
       '5e111111-1111-1111-1111-1111111111ee', 'open', now() - (g * interval '1 minute')
  FROM generate_series(1, 5) g;

SELECT is(
  (SELECT count(*)::int FROM public.newsletter_campaign_events
    WHERE subscriber_id = '5e111111-1111-1111-1111-1111111111ee'),
  5,
  'stan wyjsciowy: piec zdublowanych otwarc tej samej doby'
);

SELECT is(
  (SELECT (e->>'count')::int
     FROM public.crm_leads l, jsonb_array_elements(l.score_breakdown) e
    WHERE l.id = '1e111111-1111-1111-1111-1111111111ee' AND e->>'key' = 'email_open'),
  5,
  'ZAWYZENIE JEST REALNE: scoring leada policzyl piec otwarc zamiast jednego'
);

SELECT cmp_ok(
  (SELECT score FROM public.crm_leads WHERE id = '1e111111-1111-1111-1111-1111111111ee'),
  '>=', 8,
  'zawyzony wynik to co najmniej 8 pkt (5 x 2 pkt za email_open, przed zanikiem)'
);

-- ---------------------------------------------------------------------------
-- Backfill migracji - DOKLADNIE ten blok, ktory wykonuje 20260814150000
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leads uuid[] := '{}';
  v_lead  uuid;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY campaign_id, subscriber_id, kind, (created_at AT TIME ZONE 'UTC')::date
        ORDER BY created_at, id
      ) AS rn
    FROM public.newsletter_campaign_events
    WHERE subscriber_id IS NOT NULL
  ),
  deleted AS (
    DELETE FROM public.newsletter_campaign_events e
    USING ranked r
    WHERE e.id = r.id
      AND r.rn > 1
    RETURNING e.subscriber_id
  )
  SELECT COALESCE(array_agg(DISTINCT cl.id), '{}'::uuid[])
    INTO v_leads
    FROM deleted d
    JOIN public.newsletter_subscribers ns ON ns.id = d.subscriber_id
    JOIN public.crm_leads cl
      ON cl.tenant_id = ns.tenant_id
     AND cl.email_norm = lower(ns.email);

  FOREACH v_lead IN ARRAY v_leads LOOP
    PERFORM public.compute_crm_lead_score(v_lead);
  END LOOP;
END $$;

SELECT is(
  (SELECT count(*)::int FROM public.newsletter_campaign_events
    WHERE subscriber_id = '5e111111-1111-1111-1111-1111111111ee'),
  1,
  'po backfillu zostaje DOKLADNIE jedno zdarzenie w dobie'
);

-- Najwczesniejsze, nie ostatnie: to ono jest pierwszym realnym sladem odbiorcy.
SELECT is(
  (SELECT date_trunc('minute', created_at) FROM public.newsletter_campaign_events
    WHERE subscriber_id = '5e111111-1111-1111-1111-1111111111ee'),
  (SELECT date_trunc('minute', now() - interval '5 minute')),
  'zostaje NAJWCZESNIEJSZE zdarzenie doby'
);

SELECT is(
  (SELECT (e->>'count')::int
     FROM public.crm_leads l, jsonb_array_elements(l.score_breakdown) e
    WHERE l.id = '1e111111-1111-1111-1111-1111111111ee' AND e->>'key' = 'email_open'),
  1,
  'SEDNO POPRAWKI: zmaterializowany scoring leada zostal przeliczony (5 -> 1), a nie zostawiony na pozniej'
);

SELECT cmp_ok(
  (SELECT score FROM public.crm_leads WHERE id = '1e111111-1111-1111-1111-1111111111ee'),
  '<', 8,
  'wynik leada spadl po deduplikacji - lead nieaktywny nie tkwi w zawyzonym pasmie'
);

-- Indeks wraca; ROLLBACK i tak cofa cala transakcje, ale test nie zostawia
-- schematu w stanie, ktory bylby klamstwem dla kolejnej asercji w tym pliku.
CREATE UNIQUE INDEX nl_campaign_events_subscriber_day_uq
  ON public.newsletter_campaign_events (
    campaign_id, subscriber_id, kind, ((created_at AT TIME ZONE 'UTC')::date)
  )
  WHERE subscriber_id IS NOT NULL;

SELECT * FROM finish();
ROLLBACK;
