CREATE OR REPLACE FUNCTION public.fantasy_ai_get_admin_status(
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
  SELECT COALESCE((
    SELECT users.is_admin
    FROM tenant_fantasy_ai.users users
    WHERE users.id = p_user_id
      AND users.id = auth.uid()
    LIMIT 1
  ), false);
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_get_admin_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_get_admin_status(UUID) TO authenticated, service_role;
