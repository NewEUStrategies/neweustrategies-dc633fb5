-- Powiązanie zapisu do newslettera z kontem użytkownika (jeśli zapisujący jest zalogowany).
-- Kolumna jest nullable - publiczny zapis anonimowy dalej działa. Brak FK do auth.users
-- (managed schema). Indeks per-user pod przyszłe listy "moje subskrypcje".
ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS newsletter_subscribers_user_id_idx
  ON public.newsletter_subscribers (user_id)
  WHERE user_id IS NOT NULL;

-- RPC: back-fill pustych pól profilu wartościami z formularza (nigdy nie nadpisuje
-- istniejących), oraz powiązanie subskrypcji newslettera z zalogowanym userem.
-- Wywoływane wyłącznie z server-fn z requireSupabaseAuth (SECURITY DEFINER, bo
-- musi napisać do public.profiles i newsletter_subscribers pod stałym search_path).
CREATE OR REPLACE FUNCTION public.join_us_link_and_backfill(
  _user_id uuid,
  _tenant_id uuid,
  _email text,
  _first_name text,
  _last_name text,
  _country text,
  _linkedin text,
  _phone text,
  _company text,
  _position text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1) Powiąż subskrypcję (tenant_id, email) z kontem, jeśli jeszcze nie powiązana.
  UPDATE public.newsletter_subscribers
     SET user_id = _user_id,
         updated_at = now()
   WHERE tenant_id = _tenant_id
     AND lower(email) = lower(_email)
     AND user_id IS DISTINCT FROM _user_id;

  -- 2) Back-fill profilu - COALESCE tylko dla pustych/NULL wartości.
  UPDATE public.profiles
     SET first_name      = COALESCE(NULLIF(first_name, ''),      NULLIF(_first_name, '')),
         last_name       = COALESCE(NULLIF(last_name, ''),       NULLIF(_last_name, '')),
         location        = COALESCE(NULLIF(location, ''),        NULLIF(_country, '')),
         linkedin_url    = COALESCE(NULLIF(linkedin_url, ''),    NULLIF(_linkedin, '')),
         phone           = COALESCE(NULLIF(phone, ''),           NULLIF(_phone, '')),
         current_company = COALESCE(NULLIF(current_company, ''), NULLIF(_company, '')),
         job_title       = COALESCE(NULLIF(job_title, ''),       NULLIF(_position, '')),
         updated_at      = now()
   WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_us_link_and_backfill(uuid,uuid,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_us_link_and_backfill(uuid,uuid,text,text,text,text,text,text,text,text) TO service_role;