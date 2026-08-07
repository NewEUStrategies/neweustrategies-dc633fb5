-- Remove synthetic full-mesh connection seed (single batch insert, all pairs of 48 profiles)
DELETE FROM public.user_connections
WHERE created_at = TIMESTAMPTZ '2026-07-23 13:39:50.413486+00';