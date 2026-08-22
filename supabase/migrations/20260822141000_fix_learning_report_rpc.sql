CREATE OR REPLACE FUNCTION public.fantasy_ai_upsert_intelligence_report(
  p_report_kind TEXT, p_period_start DATE, p_period_end DATE, p_report_title TEXT,
  p_source_snapshot JSONB, p_report_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant_fantasy_ai, public
AS $$
DECLARE report_id UUID;
BEGIN
  INSERT INTO tenant_fantasy_ai.intelligence_reports (
    report_kind, period_start, period_end, report_title, source_snapshot, report_payload
  ) VALUES (
    p_report_kind, p_period_start, p_period_end, p_report_title,
    COALESCE(p_source_snapshot, '{}'::JSONB), COALESCE(p_report_payload, '{}'::JSONB)
  )
  ON CONFLICT (report_kind, period_start, period_end) DO UPDATE SET
    report_title = EXCLUDED.report_title, source_snapshot = EXCLUDED.source_snapshot,
    report_payload = EXCLUDED.report_payload, generated_at = NOW();
  SELECT reports.report_id INTO report_id
  FROM tenant_fantasy_ai.intelligence_reports reports
  WHERE reports.report_kind = p_report_kind
    AND reports.period_start = p_period_start
    AND reports.period_end = p_period_end;
  RETURN report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fantasy_ai_upsert_intelligence_report(TEXT, DATE, DATE, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fantasy_ai_upsert_intelligence_report(TEXT, DATE, DATE, TEXT, JSONB, JSONB) TO service_role;
