type LearningLineup = {
  id: string;
  snapshot_id?: string | null;
  sport: string;
  contest_date: string;
  contest_type: string;
  lineup_mode?: string | null;
  contest_strategy?: string | null;
  players: Array<Record<string, unknown>>;
  projected_points?: number | null;
  actual_points?: number | null;
  optimal_points?: number | null;
  pct_of_optimal?: number | null;
  finish_rank?: number | null;
  field_size?: number | null;
  payout?: number | null;
  config: Record<string, unknown>;
  snapshot_manifest: Record<string, unknown>;
};

type Diagnostic = Record<string, unknown>;
type Rule = Record<string, unknown>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function supabaseUrl() { return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL'); }
function serviceRoleKey() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY'); }

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error('Supabase service-role environment is not configured');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) as T : ([] as T);
}

function parseDate(value: string | undefined, fallback: Date): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekStart(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - day);
  return value.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function eventContext(lineup: LearningLineup) {
  const context = lineup.snapshot_manifest?.understand_context as { events?: Array<Record<string, unknown>> } | undefined;
  const events = Array.isArray(context?.events) ? context.events : [];
  const players = new Set(lineup.players.map((player) => String(player.player_name ?? player.name ?? '').toLowerCase()).filter(Boolean));
  const relevant = events.filter((event) => {
    const player = String(event.player_name ?? '').toLowerCase();
    return player && players.has(player);
  });
  return {
    total: events.length,
    relevant: relevant.length,
    material: events.filter((event) => Number(event.materiality ?? 0) >= 3).length,
    types: [...new Set(events.map((event) => String(event.event_type ?? 'unknown')))],
    relevantTypes: [...new Set(relevant.map((event) => String(event.event_type ?? 'unknown')))],
  };
}

function diagnose(lineup: LearningLineup): Diagnostic {
  const projected = toNumber(lineup.projected_points);
  const actual = toNumber(lineup.actual_points);
  const optimal = toNumber(lineup.optimal_points);
  const error = projected !== null && actual !== null ? actual - projected : null;
  const absoluteError = error === null ? null : Math.abs(error);
  const ratio = projected && projected > 0 && actual !== null ? actual / projected : null;
  const optimalRatio = lineup.pct_of_optimal ?? (optimal && optimal > 0 && actual !== null ? actual / optimal : null);
  const payout = toNumber(lineup.payout);
  const rank = toNumber(lineup.finish_rank);
  const fieldSize = toNumber(lineup.field_size);
  const cashResult = payout !== null && payout > 0 ? 'cashed' : rank !== null && fieldSize !== null ? 'missed' : 'unknown';
  const reasons: string[] = [];
  if (projected === null || actual === null) reasons.push('data_quality');
  if (ratio !== null && ratio < 0.75) reasons.push('projection_overestimate');
  if (ratio !== null && ratio > 1.25) reasons.push('projection_underestimate');
  if (optimalRatio !== null && optimalRatio < 0.75) reasons.push('lineup_construction');
  if (cashResult === 'missed') reasons.push('contest_result');
  const context = eventContext(lineup);
  if (context.relevant > 0) reasons.push('news_context_present');
  if (!lineup.snapshot_id) reasons.push('missing_snapshot');
  const outcomeClass = optimalRatio !== null && optimalRatio >= 0.9
    ? 'strong'
    : optimalRatio !== null && optimalRatio >= 0.75
      ? 'acceptable'
      : reasons.includes('projection_overestimate') || reasons.includes('lineup_construction')
        ? 'miss'
        : actual !== null ? 'variance' : 'unresolved';
  return {
    generated_lineup_id: lineup.id,
    snapshot_id: lineup.snapshot_id ?? null,
    sport: lineup.sport,
    contest_date: lineup.contest_date,
    lineup_mode: lineup.lineup_mode ?? null,
    contest_strategy: lineup.contest_strategy ?? null,
    projected_points: projected,
    actual_points: actual,
    optimal_points: optimal,
    projection_error: error,
    absolute_error: absoluteError,
    pct_of_optimal: optimalRatio,
    finish_rank: rank,
    field_size: fieldSize,
    payout,
    cash_result: cashResult,
    outcome_class: outcomeClass,
    failure_reasons: [...new Set(reasons)],
    evidence: { ratio, context, rank_percentile: rank && fieldSize && fieldSize > 1 ? 1 - ((rank - 1) / (fieldSize - 1)) : null },
  };
}

function aggregateRules(diagnostics: Diagnostic[]): Rule[] {
  const groups = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.sport}:${diagnostic.lineup_mode ?? 'unknown'}`;
    groups.set(key, [...(groups.get(key) ?? []), diagnostic]);
  }
  const rules: Rule[] = [];
  for (const [key, rows] of groups) {
    const [sport, mode] = key.split(':');
    const ratios = rows.map((row) => toNumber(row.evidence && (row.evidence as Record<string, unknown>).ratio)).filter((value): value is number => value !== null);
    const optimal = rows.map((row) => toNumber(row.pct_of_optimal)).filter((value): value is number => value !== null);
    const avgRatio = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null;
    const avgOptimal = optimal.length ? optimal.reduce((sum, value) => sum + value, 0) / optimal.length : null;
    const errors = rows.filter((row) => row.failure_reasons && (row.failure_reasons as string[]).includes('projection_overestimate')).length;
    const confidence = Math.min(1, rows.length / 30);
    if (avgRatio !== null) {
      const direction = avgRatio < 0.95 ? 'overestimates' : avgRatio > 1.05 ? 'underestimates' : 'is directionally calibrated for';
      rules.push({
        rule_key: `projection_bias:${mode}`, sport, rule_type: 'projection',
        status: rows.length >= 10 && Math.abs(avgRatio - 1) >= 0.05 ? 'active' : 'candidate',
        rule_statement: `${sport.toUpperCase()} ${mode} projections ${direction} actual fantasy output by ${(Math.abs(avgRatio - 1) * 100).toFixed(1)}% on average.`,
        recommended_action: Math.abs(avgRatio - 1) >= 0.05 ? `Apply a provisional ${(avgRatio).toFixed(3)} calibration multiplier to this mode; re-evaluate after more settled slates.` : 'Keep the current projection weight while collecting more settled outcomes.',
        evidence_count: rows.length, support_score: Math.max(-1, Math.min(1, avgRatio - 1)), confidence_score: confidence,
        first_observed_at: new Date().toISOString(), last_observed_at: new Date().toISOString(),
        evidence: { average_projection_ratio: avgRatio, projection_samples: ratios.length, overestimate_count: errors },
      });
    }
    if (avgOptimal !== null) {
      rules.push({
        rule_key: `strategy_performance:${mode}`, sport, rule_type: 'strategy',
        status: rows.length >= 10 && avgOptimal >= 0.82 ? 'active' : 'candidate',
        rule_statement: `${sport.toUpperCase()} ${mode} lineups reached ${(avgOptimal * 100).toFixed(1)}% of the actual optimal score on average.`,
        recommended_action: avgOptimal >= 0.82 ? 'Retain this strategy as a qualified baseline while monitoring contest-specific results.' : 'Do not promote this strategy; increase review of player selection and correlation assumptions.',
        evidence_count: rows.length, support_score: Math.max(-1, Math.min(1, avgOptimal - 0.75)), confidence_score: confidence,
        first_observed_at: new Date().toISOString(), last_observed_at: new Date().toISOString(),
        evidence: { average_pct_of_optimal: avgOptimal, samples: optimal.length },
      });
    }
  }
  return rules;
}

function reportPayload(kind: 'daily' | 'weekly', start: string, end: string, lineups: LearningLineup[], diagnostics: Diagnostic[], rules: Rule[]) {
  const byDay = new Map<string, Diagnostic[]>();
  diagnostics.forEach((diagnostic) => byDay.set(diagnostic.contest_date as string, [...(byDay.get(diagnostic.contest_date as string) ?? []), diagnostic]));
  const summary = {
    lineups_evaluated: diagnostics.length,
    strong: diagnostics.filter((row) => row.outcome_class === 'strong').length,
    misses: diagnostics.filter((row) => row.outcome_class === 'miss').length,
    cashed: diagnostics.filter((row) => row.cash_result === 'cashed').length,
    average_pct_of_optimal: diagnostics.filter((row) => toNumber(row.pct_of_optimal) !== null).reduce((sum, row, _index, all) => sum + (Number(row.pct_of_optimal) / all.length), 0),
    news_context_snapshots: lineups.filter((lineup) => Number((lineup.snapshot_manifest?.understand_context as Record<string, unknown> | undefined)?.event_count ?? 0) > 0).length,
  };
  return {
    kind, period: { start, end }, summary,
    learnings: rules.filter((rule) => rule.status === 'active' || Number(rule.evidence_count) >= 3).map((rule) => ({ statement: rule.rule_statement, action: rule.recommended_action, confidence: rule.confidence_score, evidence_count: rule.evidence_count })),
    by_day: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, evaluated: rows.length, strong: rows.filter((row) => row.outcome_class === 'strong').length, misses: rows.filter((row) => row.outcome_class === 'miss').length, cashed: rows.filter((row) => row.cash_result === 'cashed').length, notable_reasons: [...new Set(rows.flatMap((row) => row.failure_reasons as string[]))] })),
    source_coverage: { snapshots_with_understand_context: summary.news_context_snapshots, total_snapshots: lineups.filter((lineup) => lineup.snapshot_id).length },
  };
}

function htmlEmail(title: string, payload: Record<string, any>): string {
  const summary = payload.summary ?? {};
  const learnings = (payload.learnings ?? []).map((item: any) => `<li><strong>${item.statement}</strong><br><span>${item.action}</span></li>`).join('');
  const days = (payload.by_day ?? []).map((day: any) => `<tr><td>${day.date}</td><td>${day.evaluated}</td><td>${day.strong}</td><td>${day.misses}</td><td>${day.cashed}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:720px;color:#172033"><div style="background:#0b1f3a;color:white;padding:28px;border-radius:16px"><div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#80e8ff">Fantasy AI · Learning Loop</div><h1 style="margin:8px 0 0;font-size:28px">${title}</h1></div><div style="padding:24px 4px"><div style="display:flex;gap:10px;flex-wrap:wrap"><div style="padding:14px;background:#f1f5f9;border-radius:12px"><b>${summary.lineups_evaluated ?? 0}</b><br><small>Lineups evaluated</small></div><div style="padding:14px;background:#f1f5f9;border-radius:12px"><b>${summary.cashed ?? 0}</b><br><small>Cashed</small></div><div style="padding:14px;background:#f1f5f9;border-radius:12px"><b>${summary.average_pct_of_optimal ? `${(summary.average_pct_of_optimal * 100).toFixed(1)}%` : '—'}</b><br><small>Avg optimal captured</small></div></div><h2>What the system learned</h2><ul>${learnings || '<li>Not enough settled outcomes for a validated learning yet.</li>'}</ul><h2>Daily rollup</h2><table style="border-collapse:collapse;width:100%"><tr style="text-align:left;background:#e8eef7"><th style="padding:8px">Day</th><th>Lineups</th><th>Strong</th><th>Misses</th><th>Cashed</th></tr>${days}</table><p style="color:#607087;font-size:12px">Rules become active only after repeated evidence; this report separates variance from process errors.</p></div></div>`;
}

async function sendEmail(subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('LEARNING_REPORT_EMAIL');
  const from = Deno.env.get('LEARNING_REPORT_FROM_EMAIL') ?? 'Fantasy AI <reports@resend.dev>';
  if (!key || !to) return false;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html }) });
  if (!response.ok) throw new Error(`Resend failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({})) as { end_date?: string; start_date?: string; sport?: string; include_weekly?: boolean; send_email?: boolean };
    const yesterday = shiftDate(new Date().toISOString().slice(0, 10), -1);
    const end = parseDate(body.end_date, new Date(`${yesterday}T00:00:00Z`));
    const start = body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date) ? body.start_date : shiftDate(end, -6);
    const lineups = await rpc<LearningLineup[]>('fantasy_ai_get_learning_lineups', { p_from_date: start, p_to_date: end, p_sport: body.sport ?? null });
    const diagnostics = lineups.map(diagnose);
    const diagnosticCount = diagnostics.length ? await rpc<number>('fantasy_ai_upsert_learning_diagnostics', { p_rows: diagnostics }) : 0;
    const rules = aggregateRules(diagnostics);
    const ruleCount = rules.length ? await rpc<number>('fantasy_ai_upsert_learning_rules', { p_rows: rules }) : 0;
    const reports: Array<Record<string, unknown>> = [];
    const daily = reportPayload('daily', end, end, lineups.filter((lineup) => lineup.contest_date === end), diagnostics.filter((row) => row.contest_date === end), rules);
    const dailyTitle = `Fantasy AI Learning Report - ${end}`;
    const dailyId = await rpc<string>('fantasy_ai_upsert_intelligence_report', { p_report_kind: 'daily', p_period_start: end, p_period_end: end, p_report_title: dailyTitle, p_source_snapshot: { lineup_count: lineups.length, diagnostic_count: diagnostics.length, generated_at: new Date().toISOString() }, p_report_payload: daily });
    reports.push({ kind: 'daily', id: dailyId, title: dailyTitle });
    if (body.include_weekly !== false) {
      const week = weekStart(end);
      const weekly = reportPayload('weekly', week, end, lineups, diagnostics, rules);
      const weekNumber = Math.ceil((((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${end.slice(0, 4)}-01-01T00:00:00Z`).getTime()) / 86400000) + 1) / 7);
      const weeklyTitle = `Fantasy AI Week ${String(weekNumber).padStart(2, '0')} ${end.slice(0, 4)} Action Report`;
      const weeklyId = await rpc<string>('fantasy_ai_upsert_intelligence_report', { p_report_kind: 'weekly', p_period_start: week, p_period_end: end, p_report_title: weeklyTitle, p_source_snapshot: { lineup_count: lineups.length, diagnostic_count: diagnostics.length, rule_count: rules.length, generated_at: new Date().toISOString() }, p_report_payload: weekly });
      const emailed = body.send_email !== false ? await sendEmail(weeklyTitle, htmlEmail(weeklyTitle, weekly)) : false;
      reports.push({ kind: 'weekly', id: weeklyId, title: weeklyTitle, emailed });
    }
    return jsonResponse({ period: { start, end }, lineups: lineups.length, diagnostics: diagnosticCount ?? 0, rules: ruleCount ?? 0, reports });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
