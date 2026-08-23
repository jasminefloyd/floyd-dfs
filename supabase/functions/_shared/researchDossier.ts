import type { DataGap, EvidenceRef, PlayerDecisionProfile, SlateResearchDossier } from './decisionContracts.ts';

export type SourceKind = NonNullable<EvidenceRef['source_kind']>;

export interface SourcePolicy {
  source: string;
  kind: SourceKind;
  reliability: number;
  freshness_ttl_seconds: number | null;
  official: boolean;
}

export const SOURCE_POLICIES: SourcePolicy[] = [
  { source: 'draftkings_salaries', kind: 'official', reliability: 0.98, freshness_ttl_seconds: 86_400, official: true },
  { source: 'draftkings_salary_source', kind: 'official', reliability: 0.98, freshness_ttl_seconds: 86_400, official: true },
  { source: 'rotowire_confirmed_lineups', kind: 'aggregator', reliability: 0.85, freshness_ttl_seconds: 900, official: false },
  { source: 'mlb_confirmed_lineups', kind: 'aggregator', reliability: 0.85, freshness_ttl_seconds: 900, official: false },
  { source: 'free_odds', kind: 'market', reliability: 0.82, freshness_ttl_seconds: 900, official: false },
  { source: 'ownership_projections', kind: 'aggregator', reliability: 0.68, freshness_ttl_seconds: 14_400, official: false },
  { source: 'espn_news', kind: 'media', reliability: 0.72, freshness_ttl_seconds: 172_800, official: false },
  { source: 'player_news', kind: 'media', reliability: 0.72, freshness_ttl_seconds: 172_800, official: false },
  { source: 'espn_last5', kind: 'league', reliability: 0.84, freshness_ttl_seconds: 172_800, official: false },
  { source: 'mlb_statsapi_context', kind: 'league', reliability: 0.92, freshness_ttl_seconds: 86_400, official: true },
  { source: 'nws_weather', kind: 'official', reliability: 0.9, freshness_ttl_seconds: 3_600, official: true },
  { source: 'baseball_savant_statcast', kind: 'league', reliability: 0.93, freshness_ttl_seconds: 172_800, official: true },
  { source: 'wnba_role_priors', kind: 'internal', reliability: 0.78, freshness_ttl_seconds: 2_592_000, official: false },
  { source: 'wnba_minutes_model', kind: 'modeled', reliability: 0.58, freshness_ttl_seconds: null, official: false },
  { source: 'wnba_reasoning_model', kind: 'modeled', reliability: 0.6, freshness_ttl_seconds: null, official: false },
  { source: 'wnba_scenario_model', kind: 'modeled', reliability: 0.56, freshness_ttl_seconds: null, official: false },
  { source: 'nba_reasoning_model', kind: 'modeled', reliability: 0.58, freshness_ttl_seconds: null, official: false },
  { source: 'nfl_reasoning_model', kind: 'modeled', reliability: 0.58, freshness_ttl_seconds: null, official: false },
  { source: 'golf_reasoning_model', kind: 'modeled', reliability: 0.55, freshness_ttl_seconds: null, official: false },
  { source: 'reddit_sentiment', kind: 'community', reliability: 0.25, freshness_ttl_seconds: 86_400, official: false },
  { source: 'projections', kind: 'modeled', reliability: 0.5, freshness_ttl_seconds: null, official: false },
  { source: 'projection_calibration', kind: 'internal', reliability: 0.8, freshness_ttl_seconds: 2_592_000, official: false },
];

const DEFAULT_POLICY: SourcePolicy = { source: 'unknown', kind: 'unknown', reliability: 0.4, freshness_ttl_seconds: null, official: false };

export function sourcePolicy(source: string): SourcePolicy {
  return SOURCE_POLICIES.find((policy) => policy.source === source)
    ?? SOURCE_POLICIES.find((policy) => source.startsWith(policy.source))
    ?? { ...DEFAULT_POLICY, source };
}

export function freshnessState(freshnessSeconds: number | null | undefined, policy: SourcePolicy): 'fresh' | 'stale' | 'unknown' {
  if (freshnessSeconds == null || policy.freshness_ttl_seconds == null) return 'unknown';
  return freshnessSeconds <= policy.freshness_ttl_seconds ? 'fresh' : 'stale';
}

export function evidenceForSourceHealth(
  sourceHealth: Record<string, { status: string; observed_at?: string | null; freshness_seconds?: number | null; provider?: string; coverage?: { matched: number; total: number; percent: number }; data_class?: string }>,
): EvidenceRef[] {
  return Object.entries(sourceHealth).map(([source, health]) => {
    const policy = sourcePolicy(source);
    const state = freshnessState(health.freshness_seconds, policy);
    return {
      evidence_id: `source:${source}`,
      source,
      source_kind: policy.kind,
      observed_at: health.observed_at ?? null,
      freshness_seconds: health.freshness_seconds ?? null,
      fact: `${source} status=${health.status}; freshness=${state}`,
      normalized_fact: { status: health.status, provider: health.provider ?? null, coverage: health.coverage ?? null, data_class: health.data_class ?? null, freshness: state },
      is_modeled: health.data_class === 'modeled',
      confidence: policy.reliability,
    } satisfies EvidenceRef;
  });
}

export function buildPlayerHierarchy(profiles: PlayerDecisionProfile[]): Record<string, string[]> {
  const groups: Record<string, string[]> = { 'A+': [], A: [], 'A-': [], leverage: [], value: [], avoid: [], watch: [] };
  for (const profile of profiles) {
    const median = profile.median ?? 0;
    const ceiling = profile.p90 ?? profile.p75 ?? median;
    const efficiency = profile.salary_efficiency ?? 0;
    const leverage = profile.leverage ?? 0;
    const uncertain = profile.freshness_seconds == null || profile.bust_probability == null;
    const tier = ceiling >= 30 && median >= 20 ? 'A+'
      : median >= 16 ? 'A'
        : efficiency >= 0.0045 ? 'value'
          : leverage >= 0.15 ? 'leverage'
            : uncertain ? 'watch' : 'A-';
    groups[tier].push(profile.player_id);
  }
  return groups;
}

export function buildGenericScripts(dossier: Pick<SlateResearchDossier, 'sport' | 'contest_type' | 'market_context' | 'observability'>, evidenceIds: string[]): SlateResearchDossier['game_scripts'] {
  const market = dossier.market_context;
  const hasMarket = Object.keys(market).length > 0;
  return [
    { script_key: 'base_case', thesis: 'Primary projections and verified slate context hold.', required_conditions: ['Core salary and roster inputs remain valid.'], opposing_conditions: ['Material late news invalidates the current roster.'], team_exposure_targets: {}, player_inclusion_rules: ['Prefer stable opportunity and verified availability.'], player_exclusion_rules: ['Exclude players marked out.'], probability: hasMarket ? 0.5 : 0.34, evidence_ids: evidenceIds, confidence: hasMarket ? 0.65 : 0.45, uncertainty: hasMarket ? [] : ['Market context is unavailable.'] },
    { script_key: 'high_environment', thesis: 'The slate environment produces more scoring than the base case.', required_conditions: ['At least one usable market or environment signal exists.'], opposing_conditions: ['Pace, weather, or market conditions deteriorate.'], team_exposure_targets: {}, player_inclusion_rules: ['Prefer ceiling and positively correlated environment exposure.'], player_exclusion_rules: ['Limit low-opportunity players without a role edge.'], probability: hasMarket ? 0.3 : 0.33, evidence_ids: evidenceIds, confidence: hasMarket ? 0.55 : 0.35, uncertainty: ['Environment signal is modeled, not a guarantee.'] },
    { script_key: 'fragile_news_or_role', thesis: 'A material availability or role change redistributes opportunity.', required_conditions: ['A late availability or role change is confirmed.'], opposing_conditions: ['Expected starters and roles remain unchanged.'], team_exposure_targets: {}, player_inclusion_rules: ['Include verified replacements only when opportunity changes.'], player_exclusion_rules: ['Avoid unsupported questionable-player assumptions.'], probability: 0.2, evidence_ids: evidenceIds, confidence: 0.4, uncertainty: ['No late role change may occur.'] },
  ];
}

export function buildDataGaps(
  sourceHealth: Record<string, { status: string; observed_at?: string | null; freshness_seconds?: number | null }>,
  requiredSources: string[],
): DataGap[] {
  return Object.entries(sourceHealth).flatMap(([source, health]) => {
    const policy = sourcePolicy(source);
    const stale = freshnessState(health.freshness_seconds, policy) === 'stale';
    if (health.status === 'ok' && !stale) return [];
    return [{ key: source, message: health.status === 'unavailable' ? `${source} is unavailable.` : stale ? `${source} is stale.` : `${source} is only partially available.`, required: requiredSources.includes(source), source, observed_at: health.observed_at ?? null }];
  });
}

export function detectContradictions(evidence: EvidenceRef[]): SlateResearchDossier['contradictions'] {
  const byFact = new Map<string, EvidenceRef[]>();
  for (const item of evidence) {
    const key = typeof item.normalized_fact?.fact_key === 'string' ? item.normalized_fact.fact_key : null;
    if (!key) continue;
    byFact.set(key, [...(byFact.get(key) ?? []), item]);
  }
  return [...byFact.entries()].filter(([, items]) => new Set(items.map((item) => JSON.stringify(item.normalized_fact))).size > 1).map(([factKey, items]) => ({
    fact_key: factKey,
    sources: items.map((item) => item.source),
    summaries: items.map((item) => item.fact ?? item.source),
    severity: items.some((item) => sourcePolicy(item.source).official) ? 'high' : 'medium',
  }));
}

export function corroborationGaps(evidence: EvidenceRef[]): DataGap[] {
  const highImpact = evidence.filter((item) => ['availability', 'injury', 'role', 'transaction', 'lineup'].includes(String(item.normalized_fact?.impact_type ?? '').toLowerCase()));
  const grouped = new Map<string, EvidenceRef[]>();
  highImpact.forEach((item) => {
    const key = String(item.normalized_fact?.fact_key ?? item.fact ?? item.evidence_id);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });
  return [...grouped.entries()].filter(([, items]) => new Set(items.map((item) => item.source)).size < 2).map(([key, items]) => ({
    key: `corroboration:${key}`,
    message: `High-impact ${key} has only one corroborating source when corroboration is available.`,
    required: false,
    source: items[0]?.source,
    observed_at: items[0]?.observed_at ?? null,
  }));
}

export function buildMatchupEdges(profiles: PlayerDecisionProfile[]): SlateResearchDossier['matchup_edges'] {
  return profiles.filter((profile) => profile.matchup_edge != null).sort((a, b) => Number(b.matchup_edge ?? 0) - Number(a.matchup_edge ?? 0)).slice(0, 12).map((profile) => ({
    player_id: profile.player_id,
    summary: `${profile.player_name} has a modeled matchup edge of ${Number(profile.matchup_edge ?? 0).toFixed(2)}; verify the underlying role and matchup inputs.`,
    edge: profile.matchup_edge,
    evidence_ids: profile.evidence_ids,
  }));
}

export function buildSlateRisks(dossier: Pick<SlateResearchDossier, 'data_gaps' | 'contradictions' | 'game_scripts'>): SlateResearchDossier['slate_risks'] {
  return [
    ...(dossier.data_gaps ?? []).map((gap) => ({ risk: gap.message, severity: gap.required ? 'high' as const : 'medium' as const, evidence_ids: gap.source ? [`source:${gap.source}`] : [], assumption: 'The missing or stale input does not materially change the slate.' })),
    ...(dossier.contradictions ?? []).map((item) => ({ risk: `Contradictory fact: ${item.fact_key}`, severity: item.severity, evidence_ids: item.sources, assumption: item.summaries.join(' / ') })),
    ...(dossier.game_scripts ?? []).flatMap((script) => script.uncertainty.slice(0, 2).map((uncertainty) => ({ risk: `${script.script_key}: ${uncertainty}`, severity: 'medium' as const, evidence_ids: script.evidence_ids, assumption: script.thesis }))),
  ].slice(0, 30);
}

export function buildPrelockChecklist(dataGaps: DataGap[], contradictions: SlateResearchDossier['contradictions'] = []): SlateResearchDossier['prelock_checklist'] {
  return [
    { item: 'Confirmed lineups and scratches re-checked before lock', status: dataGaps.some((gap) => /lineup|availability/i.test(gap.key)) ? 'unresolved' as const : 'resolved' as const, source: 'confirmed-lineups' },
    { item: 'Weather and market movement re-checked before lock', status: dataGaps.some((gap) => /weather|odds|market/i.test(gap.key)) ? 'caution' as const : 'resolved' as const, source: 'weather-market' },
    { item: 'Ownership re-checked before lock', status: dataGaps.some((gap) => /ownership/i.test(gap.key)) ? 'unresolved' as const : 'resolved' as const, source: 'ownership' },
    { item: 'Contradictions reviewed', status: contradictions.length ? 'caution' as const : 'resolved' as const, source: 'source-reconciliation' },
  ];
}

export function enrichGameScripts(scripts: SlateResearchDossier['game_scripts'], sport: string): SlateResearchDossier['game_scripts'] {
  return scripts.map((script) => ({
    ...script,
    expected_score_range: { low: null, high: null, unit: sport === 'golf' ? 'relative scoring' : 'fantasy/game points' },
    team_run_distribution: sport === 'mlb' ? {} : undefined,
    starter_assumptions: script.required_conditions.filter((condition) => /starter|role|quarterback|pitcher|lineup|minutes|active/i.test(condition)),
    preferred_stacks: script.player_inclusion_rules.filter((rule) => /stack|pair|correlat|bring-back|team|creator/i.test(rule)),
    bring_backs: script.player_inclusion_rules.filter((rule) => /bring-back|opponent|run-back/i.test(rule)),
    captain_candidates: script.player_inclusion_rules.filter((rule) => /captain|creator|star|high-minute|primary/i.test(rule)),
    fade_rules: script.player_exclusion_rules,
    ownership_expectation: ['Use observed ownership when available; otherwise treat leverage as modeled and uncertain.'],
    pace_range: sport === 'golf' ? undefined : { low: null, high: null, unit: sport === 'mlb' ? 'runs' : 'possessions/plays' },
    failure_conditions: script.opposing_conditions,
  }));
}

export function summarizeChanges(current: SlateResearchDossier, previous?: SlateResearchDossier | null): string[] {
  if (!previous) return ['No prior dossier was available for comparison.'];
  const changes: string[] = [];
  if (current.readiness_status !== previous.readiness_status) changes.push(`Readiness changed from ${previous.readiness_status} to ${current.readiness_status}.`);
  const currentSources = new Set(current.source_evidence.map((item) => `${item.source}:${item.fact}`));
  const previousSources = new Set(previous.source_evidence.map((item) => `${item.source}:${item.fact}`));
  const added = [...currentSources].filter((item) => !previousSources.has(item));
  const removed = [...previousSources].filter((item) => !currentSources.has(item));
  if (added.length) changes.push(`${added.length} source observations changed or were added.`);
  if (removed.length) changes.push(`${removed.length} prior source observations are no longer present.`);
  if (current.data_gaps.length !== previous.data_gaps.length) changes.push(`Data-gap count changed from ${previous.data_gaps.length} to ${current.data_gaps.length}.`);
  return changes.length ? changes : ['No material dossier changes detected.'];
}
