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
  const learnings = (payload.learnings ?? []).map((item: any) => `<tr><td style="padding:14px 0;border-bottom:1px solid #e5eaf1;vertical-align:top"><div style="font-weight:700;color:#0b1f3a">${item.statement}</div><div style="margin-top:5px;color:#607087;line-height:1.5">${item.action}</div><div style="margin-top:7px;font-size:11px;color:#0891b2;text-transform:uppercase;letter-spacing:.08em">${item.evidence_count} observations · ${(Number(item.confidence ?? 0) * 100).toFixed(0)}% confidence</div></td></tr>`).join('');
  const days = (payload.by_day ?? []).map((day: any) => `<tr><td style="padding:11px 8px;border-bottom:1px solid #e5eaf1;font-weight:600">${day.date}</td><td style="padding:11px 8px;border-bottom:1px solid #e5eaf1">${day.evaluated}</td><td style="padding:11px 8px;border-bottom:1px solid #e5eaf1;color:#15803d;font-weight:700">${day.strong}</td><td style="padding:11px 8px;border-bottom:1px solid #e5eaf1;color:#b45309;font-weight:700">${day.misses}</td><td style="padding:11px 8px;border-bottom:1px solid #e5eaf1">${day.cashed}</td></tr>`).join('');
  const optimal = summary.average_pct_of_optimal ? `${(summary.average_pct_of_optimal * 100).toFixed(1)}%` : '—';
  const card = (value: string | number, label: string, tone = '#0b1f3a') => `<td style="width:33%;padding:0 5px 0 0"><div style="background:#f3f7fb;border:1px solid #e4ebf3;border-radius:14px;padding:16px 14px"><div style="font-size:25px;font-weight:800;color:${tone}">${value}</div><div style="margin-top:4px;color:#607087;font-size:11px;text-transform:uppercase;letter-spacing:.07em">${label}</div></div></td>`;
  return `<!doctype html><html><body style="margin:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:720px;margin:0 auto;padding:24px 14px"><div style="background:#0b1f3a;border-radius:18px;padding:30px 28px;color:#fff"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#80e8ff;font-weight:700">Fantasy AI · Learning Loop</div><h1 style="margin:10px 0 7px;font-size:28px;line-height:1.15">${title}</h1><p style="margin:0;color:#c7d7e8;font-size:14px">A decision-quality review of what happened, what was learned, and what changes next.</p></div><div style="background:#fff;margin-top:14px;border-radius:18px;padding:24px 24px 28px"><div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#0891b2;font-weight:700">Executive summary</div><h2 style="margin:7px 0 18px;font-size:21px;color:#0b1f3a">What changed this week</h2><table role="presentation" style="width:100%;border-collapse:collapse"><tr>${card(summary.lineups_evaluated ?? 0, 'Lineups evaluated')}${card(summary.cashed ?? 0, 'Cashed', '#15803d')}${card(optimal, 'Avg optimal captured', '#0891b2')}</tr></table><div style="margin-top:22px;padding:15px 16px;background:#f8fafc;border-left:4px solid #06b6d4;border-radius:8px;color:#475569;font-size:13px;line-height:1.55">The loop only promotes a rule when repeated evidence supports it. Normal variance is kept separate from projection, data-quality, and lineup-construction errors.</div><h2 style="margin:28px 0 10px;font-size:19px;color:#0b1f3a">Validated learnings</h2><table style="width:100%;border-collapse:collapse">${learnings || '<tr><td style="padding:12px 0;color:#607087">Not enough settled outcomes for a validated learning yet.</td></tr>'}</table><h2 style="margin:28px 0 10px;font-size:19px;color:#0b1f3a">How the system improved</h2><p style="margin:0;color:#607087;font-size:14px;line-height:1.6">The findings above are now stored as candidate or active learning rules. Active rules can influence future calibration and strategy evaluation only after the required evidence threshold is met.</p><h2 style="margin:28px 0 10px;font-size:19px;color:#0b1f3a">Daily rollup</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left;background:#edf5fa;color:#475569;text-transform:uppercase;font-size:10px;letter-spacing:.06em"><th style="padding:10px 8px">Day</th><th style="padding:10px 8px">Lineups</th><th style="padding:10px 8px">Strong</th><th style="padding:10px 8px">Misses</th><th style="padding:10px 8px">Cashed</th></tr>${days || '<tr><td colspan="5" style="padding:12px 8px;color:#607087">No settled lineups recorded.</td></tr>'}</table><p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #e5eaf1;color:#94a3b8;font-size:11px;line-height:1.5">Generated by the Fantasy AI outcome loop. The permanent report record is also stored in the intelligence reports ledger.</p></div></div></body></html>`;
}

async function sendEmail(subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('LEARNING_REPORT_EMAIL') ?? Deno.env.get('WEEKLY_LEARNING_REPORT_EMAIL');
  const from = Deno.env.get('LEARNING_REPORT_FROM_EMAIL') ?? Deno.env.get('WEEKLY_LEARNING_REPORT_FROM') ?? 'Fantasy AI <reports@resend.dev>';
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
