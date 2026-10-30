import { createHash } from 'node:crypto';
import type { SportsDataIoClient } from '../src/lib/engine/sportsDataIoProvider.js';
import { DEFAULT_RSS_FEEDS, parseRss } from '../src/lib/engine/rssProvider.js';

export interface NbaStreetTeamObservationInput {
  id: string;
  provider: string;
  sourceRecordId?: string;
  sourceUrl: string;
  subjectKind: 'PLAYER' | 'TEAM' | 'EVENT' | 'LEAGUE';
  subjectId: string;
  claim: string;
  classification: 'OFFICIAL_CONFIRMED' | 'CORROBORATED_REPORT' | 'SINGLE_SOURCE_REPORT' | 'HYPOTHESIS' | 'STALE' | 'SUPERSEDED';
  confidence: number;
  publishedAt?: string;
  effectiveAt?: string;
  observedAt: string;
  retrievedAt: string;
  payload: Record<string, unknown>;
}

export interface NbaStreetTeamProviderResult {
  rosterAvailable: boolean;
  observations: NbaStreetTeamObservationInput[];
  providerDiagnostics: Array<{ provider: string; status: 'SUCCEEDED' | 'EMPTY' | 'FAILED' | 'RATE_LIMITED'; retrievedAt: string; freshness: 'FRESH' | 'STALE' | 'UNKNOWN'; errorCode?: string }>;
  unknowns: Array<{ question: string; reason: string; subjectId?: string }>;
  rosterState: Array<{ teamId: string; playerId: string; status: string; validFrom: string; evidenceIds: string[] }>;
  availability: Array<{ playerId: string; status: string; observedAt: string; evidenceIds: string[] }>;
  transactions: Array<{ playerId: string; transactionType: string; effectiveAt: string; evidenceIds: string[] }>;
  resolvedFacts: Array<{ id: string; subject: { kind: 'PLAYER' | 'TEAM' | 'EVENT' | 'LEAGUE'; id: string }; factType: string; value: unknown; observationIds: string[]; confidence: number; effectiveAt?: string; resolvedAt: string; ruleVersion: string }>;
}

type JsonRow = Record<string, unknown>;
type FeedResult = { name: string; route: string; sourceUrl: string; retrievedAt: string; rows?: JsonRow[]; error?: unknown };
const UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE = 0.5;

/** NBA-only SportsDataIO adapter. Feed fields are normalized conservatively; unknown transaction
 * records remain visible as unresolved diagnostics until their field schema is confirmed. */
export class SportsDataIoNbaStreetTeamProvider {
  private readonly client: SportsDataIoClient;
  private readonly now: () => Date;
  private readonly fetcher: typeof fetch;

  constructor(client: SportsDataIoClient, now: () => Date = () => new Date(), fetcher: typeof fetch = fetch) {
    this.client = client;
    this.now = now;
    this.fetcher = fetcher;
  }

  async collect(input: { windowStart: Date; asOf?: Date; signal?: AbortSignal }): Promise<NbaStreetTeamProviderResult> {
    const date = easternFeedDate(input.asOf ?? this.now());
    const priorDate = easternFeedDate(input.windowStart);
    const feedSpecs = [
      { name: 'SportsDataIO NBA Players', route: '/nba/scores/json/Players', sourceUrl: this.client.sourceUrl('NBA', 'scores', 'Players'), call: () => this.client.get<unknown>('NBA', 'scores', 'Players', undefined, input.signal) },
      { name: 'SportsDataIO NBA InjuredPlayers', route: '/nba/projections/json/InjuredPlayers', sourceUrl: this.client.sourceUrl('NBA', 'projections', 'InjuredPlayers'), call: () => this.client.get<unknown>('NBA', 'projections', 'InjuredPlayers', undefined, input.signal) },
      { name: 'SportsDataIO NBA StartingLineupsByDate', route: `/nba/projections/json/StartingLineupsByDate/${date}`, sourceUrl: this.client.sourceUrl('NBA', 'projections', 'StartingLineupsByDate', date), call: () => this.client.get<unknown>('NBA', 'projections', 'StartingLineupsByDate', date, input.signal) },
      { name: 'SportsDataIO NBA TransactionsByDate', route: `/nba/scores/json/TransactionsByDate/${date}`, sourceUrl: this.client.sourceUrl('NBA', 'scores', 'TransactionsByDate', date), call: () => this.client.get<unknown>('NBA', 'scores', 'TransactionsByDate', date, input.signal) },
      ...(priorDate === date ? [] : [{ name: 'SportsDataIO NBA TransactionsByDate (prior day)', route: `/nba/scores/json/TransactionsByDate/${priorDate}`, sourceUrl: this.client.sourceUrl('NBA', 'scores', 'TransactionsByDate', priorDate), call: () => this.client.get<unknown>('NBA', 'scores', 'TransactionsByDate', priorDate, input.signal) }]),
    ];
    const results = await Promise.all(feedSpecs.map(async (feed): Promise<FeedResult> => {
      const retrievedAt = this.now().toISOString();
      try {
        const payload = await feed.call();
        if (!Array.isArray(payload)) throw new Error('Provider returned a non-array NBA feed.');
        return { name: feed.name, route: feed.route, sourceUrl: feed.sourceUrl, retrievedAt, rows: payload.flatMap((row) => asRow(row) ? [asRow(row)!] : []) };
      } catch (error) { return { name: feed.name, route: feed.route, sourceUrl: feed.sourceUrl, retrievedAt, error }; }
    }));

    const diagnostics = results.map((result) => ({
      provider: result.name,
      status: result.error ? /HTTP 429/.test(errorText(result.error)) ? 'RATE_LIMITED' as const : 'FAILED' as const : result.rows?.length ? 'SUCCEEDED' as const : 'EMPTY' as const,
      retrievedAt: result.retrievedAt,
      freshness: result.error ? 'UNKNOWN' as const : 'FRESH' as const,
      ...(result.error ? { errorCode: safeErrorCode(result.error) } : {}),
    }));
    const unknowns: NbaStreetTeamProviderResult['unknowns'] = [];
    const observations: NbaStreetTeamObservationInput[] = [];
    const facts: NbaStreetTeamProviderResult['resolvedFacts'] = [];
    const rosterFeed = results.find((result) => result.name.endsWith('Players'));
    const injuriesFeed = results.find((result) => result.name.endsWith('InjuredPlayers'));
    const lineupsFeed = results.find((result) => result.name.endsWith('StartingLineupsByDate'));
    const transactionFeeds = results.filter((result) => result.name.includes('TransactionsByDate'));

    if (!rosterFeed?.rows) unknowns.push({ question: 'Refresh NBA roster state from SportsDataIO.', reason: 'The NBA player roster feed did not return a usable response.' });
    const rosterRecords = rosterFeed?.rows ?? [];
    const rosterById = new Map<string, JsonRow>();
    const conflictedIds = new Set<string>();
    for (const row of rosterRecords) {
      const id = readId(row.PlayerID);
      const name = readText(row.Name) ?? joinName(row);
      const team = readText(row.Team);
      if (!id || !name || !team) {
        unknowns.push({ question: 'Resolve a provider roster record with missing identity fields.', reason: 'The record lacked a stable player ID, player name, or current team.' });
        continue;
      }
      const previous = rosterById.get(id);
      if (previous && (readText(previous.Name) !== name || readText(previous.Team) !== team)) conflictedIds.add(id);
      else rosterById.set(id, row);
    }
    for (const id of conflictedIds) {
      rosterById.delete(id);
      unknowns.push({ subjectId: `nba:player:sportsdataio:${id}`, question: 'Resolve conflicting NBA roster identity records.', reason: 'The same SportsDataIO PlayerID was returned with different names or teams; it was quarantined.' });
    }

    const injuryById = new Map<string, JsonRow>();
    for (const row of [...rosterRecords.filter((item) => readText(item.InjuryStatus)), ...(injuriesFeed?.rows ?? [])]) {
      const id = readId(row.PlayerID);
      if (id && readText(row.InjuryStatus)) injuryById.set(id, row);
    }
    const dkPlayerIds = new Map<string, Set<string>>();
    for (const [providerPlayerId, row] of rosterById) {
      const draftKingsId = readId(row.DraftKingsPlayerID);
      if (draftKingsId) dkPlayerIds.set(draftKingsId, new Set([...(dkPlayerIds.get(draftKingsId) ?? []), providerPlayerId]));
    }
    const ambiguousDraftKingsIds = new Set([...dkPlayerIds].filter(([, ids]) => ids.size > 1).map(([id]) => id));
    for (const id of ambiguousDraftKingsIds) unknowns.push({ question: 'Resolve an ambiguous DraftKings player cross-reference.', reason: `SportsDataIO DraftKingsPlayerID ${id} mapped to multiple canonical NBA players and was withheld.` });
    for (const [providerPlayerId, row] of rosterById) {
      const canonicalId = `nba:player:sportsdataio:${providerPlayerId}`;
      const name = readText(row.Name) ?? joinName(row)!;
      const team = readText(row.Team)!;
      const rawDraftKingsId = readId(row.DraftKingsPlayerID);
      const draftKingsId = rawDraftKingsId && !ambiguousDraftKingsIds.has(rawDraftKingsId) ? rawDraftKingsId : undefined;
      const retrievedAt = rosterFeed!.retrievedAt;
      const rosterObservation = makeObservation({
        provider: 'SportsDataIO', route: rosterFeed!.route, sourceUrl: rosterFeed!.sourceUrl, sourceRecordId: providerPlayerId, subjectKind: 'PLAYER', subjectId: canonicalId,
        claim: `${name} is listed on the SportsDataIO NBA roster for ${team}.`, confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, retrievedAt,
        payload: { playerId: providerPlayerId, name, team, status: readText(row.Status) ?? null, draftKingsPlayerId: draftKingsId ?? null },
      });
      observations.push(rosterObservation);
      const factId = stableId(`fact:${rosterObservation.sourceRecordId}:${rosterObservation.payload.team}:${rosterObservation.retrievedAt}`);
      facts.push({ id: factId, subject: { kind: 'PLAYER', id: canonicalId }, factType: 'roster.membership', value: { displayName: name, providerPlayerId, teamId: readId(row.TeamID) ? `nba:team:sportsdataio:${readId(row.TeamID)}` : `nba:team:key:${team}`, team, providerStatus: readText(row.Status) ?? 'UNKNOWN', draftKingsPlayerId: draftKingsId ?? null }, observationIds: [rosterObservation.id], confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, resolvedAt: retrievedAt, ruleVersion: 'street-team.identity.v1' });
    }

    for (const [providerPlayerId, injury] of injuryById) {
      const roster = rosterById.get(providerPlayerId);
      const canonicalId = `nba:player:sportsdataio:${providerPlayerId}`;
      const name = readText(injury.Name) ?? (roster ? readText(roster.Name) ?? joinName(roster) : undefined);
      const team = readText(injury.Team) ?? (roster ? readText(roster.Team) : undefined);
      const status = readText(injury.InjuryStatus);
      if (!name || !team || !status || conflictedIds.has(providerPlayerId)) {
        unknowns.push({ subjectId: canonicalId, question: 'Resolve NBA injury status to a roster identity.', reason: 'An injury record lacked a stable matching player identity, team, or status and was not applied to current state.' });
        continue;
      }
      const retrievedAt = injuriesFeed?.rows?.includes(injury) ? injuriesFeed.retrievedAt : rosterFeed?.retrievedAt ?? this.now().toISOString();
      const observation = makeObservation({
        provider: 'SportsDataIO', route: injuriesFeed?.rows?.includes(injury) ? injuriesFeed.route : rosterFeed?.route ?? '/nba/scores/json/Players', sourceUrl: injuriesFeed?.rows?.includes(injury) ? injuriesFeed.sourceUrl : rosterFeed?.sourceUrl,
        sourceRecordId: providerPlayerId, subjectKind: 'PLAYER', subjectId: canonicalId,
        claim: `${name} has NBA injury status “${status}” in the SportsDataIO feed.`, confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, retrievedAt,
        payload: { playerId: providerPlayerId, name, team, injuryStatus: status, injuryBodyPart: readText(injury.InjuryBodyPart) ?? null, injuryStartDate: readText(injury.InjuryStartDate) ?? null, injuryNote: readText(injury.InjuryNote) ?? null },
      });
      observations.push(observation);
      const availability = normalizedAvailability(status);
      const factId = stableId(`fact:availability:${providerPlayerId}:${status}:${retrievedAt}`);
      facts.push({ id: factId, subject: { kind: 'PLAYER', id: canonicalId }, factType: 'availability.injury_status', value: { status, normalizedStatus: availability }, observationIds: [observation.id], confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, resolvedAt: retrievedAt, ruleVersion: 'street-team.availability.v1' });
    }

    for (const feed of transactionFeeds) {
      for (const transaction of feed.rows ?? []) {
        const providerPlayerId = readId(transaction.PlayerID);
        const name = readText(transaction.Name);
        const transactionType = readText(transaction.Type);
        const date = readText(transaction.Date);
        if (!providerPlayerId || !name || !transactionType || !date) {
          unknowns.push({ question: 'Resolve an NBA transaction record to a canonical player and effective date.', reason: 'The provider transaction record lacked PlayerID, Name, Type, or Date; it was retained as unresolved source evidence.' });
          const recordHash = stableHash(JSON.stringify(transaction));
          observations.push(makeObservation({ provider: 'SportsDataIO', route: feed.route, sourceUrl: feed.sourceUrl, sourceRecordId: recordHash, subjectKind: 'EVENT', subjectId: `nba:transaction:unresolved:${recordHash}`, claim: 'Unresolved SportsDataIO NBA transaction record; fields are incomplete.', confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, retrievedAt: feed.retrievedAt, payload: transaction }));
          continue;
        }
        const roster = rosterById.get(providerPlayerId);
        if (roster && readText(roster.Name) && readText(roster.Name) !== name && !conflictedIds.has(providerPlayerId)) {
          unknowns.push({ subjectId: `nba:player:sportsdataio:${providerPlayerId}`, question: 'Reconcile a transaction record with the current provider player identity.', reason: 'Transaction name does not match the current roster record for the same stable SportsDataIO PlayerID.' });
          observations.push(makeObservation({ provider: 'SportsDataIO', route: feed.route, sourceUrl: feed.sourceUrl, sourceRecordId: `${providerPlayerId}:${date}:${transactionType}`, subjectKind: 'EVENT', subjectId: `nba:transaction:unresolved:${stableHash(`${providerPlayerId}:${date}:${transactionType}`)}`, claim: `Unresolved NBA transaction record for SportsDataIO PlayerID ${providerPlayerId}.`, confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, retrievedAt: feed.retrievedAt, payload: transaction }));
          continue;
        }
        const canonicalId = `nba:player:sportsdataio:${providerPlayerId}`;
        const effectiveAt = dateOnlyTimestamp(date);
        const recordKey = `${providerPlayerId}:${date}:${transactionType}:${readId(transaction.FormerTeamID) ?? ''}:${readId(transaction.TeamID) ?? ''}`;
        const observation = makeObservation({
          provider: 'SportsDataIO', route: feed.route, sourceRecordId: recordKey, subjectKind: 'PLAYER', subjectId: canonicalId,
          claim: `${name}: ${transactionType}${readText(transaction.FormerTeam) ? ` from ${readText(transaction.FormerTeam)}` : ''}${readText(transaction.Team) ? ` to ${readText(transaction.Team)}` : ''}.`, confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, retrievedAt: feed.retrievedAt, effectiveAt, sourceUrl: feed.sourceUrl,
          payload: { playerId: providerPlayerId, name, transactionType, transactionDate: date, createdAt: readText(transaction.Created) ?? null, updatedAt: readText(transaction.Updated) ?? null, formerTeamId: readId(transaction.FormerTeamID) ?? null, formerTeam: readText(transaction.FormerTeam) ?? null, teamId: readId(transaction.TeamID) ?? null, team: readText(transaction.Team) ?? null, note: readText(transaction.Note) ?? null },
        });
        observations.push(observation);
        facts.push({ id: stableId(`fact:transaction:${recordKey}:${feed.retrievedAt}`), subject: { kind: 'PLAYER', id: canonicalId }, factType: 'transaction.record', value: { transactionType, fromTeamId: readId(transaction.FormerTeamID) ? `nba:team:sportsdataio:${readId(transaction.FormerTeamID)}` : undefined, toTeamId: readId(transaction.TeamID) ? `nba:team:sportsdataio:${readId(transaction.TeamID)}` : undefined, transactionDate: date, note: readText(transaction.Note) }, observationIds: [observation.id], confidence: 0.5, effectiveAt, resolvedAt: feed.retrievedAt, ruleVersion: 'street-team.transaction.v1' });
      }
    }
    const transactionCount = transactionFeeds.reduce((count, feed) => count + (feed.rows?.length ?? 0), 0);
    if (transactionFeeds.some((feed) => feed.error)) unknowns.push({ question: 'Refresh recent NBA transactions.', reason: 'At least one NBA transaction feed request failed; previous roster state is retained and marked incomplete.' });
    if (transactionCount && !observations.some((observation) => observation.sourceUrl.includes('TransactionsByDate'))) unknowns.push({ question: 'Map SportsDataIO NBA transaction records to canonical player identities.', reason: `${transactionCount} transaction feed record(s) were returned but could not be normalized.` });
    if (lineupsFeed?.error) unknowns.push({ question: 'Refresh NBA lineup context.', reason: 'The starting lineup feed failed; no lineup claim was inferred from the roster or injury feeds.' });
    else if (lineupsFeed?.rows?.length) {
      for (const game of lineupsFeed.rows) {
        for (const [side, teamIdField, teamField, lineupField] of [['HOME', 'HomeTeamID', 'HomeTeam', 'HomeLineup'], ['AWAY', 'AwayTeamID', 'AwayTeam', 'AwayLineup']] as const) {
          const teamId = readId(game[teamIdField]); const team = readText(game[teamField]); const lineup = Array.isArray(game[lineupField]) ? game[lineupField] as unknown[] : [];
          if (!teamId || !team) { if (lineup.length) unknowns.push({ question: `Resolve ${side.toLowerCase()} team identity in an NBA lineup.`, reason: 'Lineup contained players but did not include a stable team ID and team key.' }); continue; }
          for (const rawPlayer of lineup) {
            const player = asRow(rawPlayer); if (!player) continue;
            const playerId = readId(player.PlayerID); const name = readText(player.Name) ?? joinName(player);
            if (!playerId || !name) { unknowns.push({ question: 'Resolve an NBA lineup player identity.', reason: 'The lineup record lacked a stable SportsDataIO PlayerID or player name.' }); continue; }
            const canonicalId = `nba:player:sportsdataio:${playerId}`;
            const rosterPlayer = rosterById.get(playerId);
            if (rosterPlayer && readId(rosterPlayer.TeamID) && readId(rosterPlayer.TeamID) !== teamId) {
              unknowns.push({ subjectId: canonicalId, question: 'Reconcile conflicting NBA roster and lineup team assignments.', reason: 'The same stable SportsDataIO PlayerID appeared under different teams in the roster and game lineup feeds.' });
              continue;
            }
            const confirmed = player.Confirmed === true; const starting = player.Starting === true;
            const lineupStatus = readText(player.LineupStatus) ?? (starting ? confirmed ? 'CONFIRMED_STARTER' : 'PROJECTED_STARTER' : 'ACTIVE');
            const observedAt = lineupsFeed.retrievedAt;
            const observation = makeObservation({ provider: 'SportsDataIO', route: lineupsFeed.route, sourceUrl: lineupsFeed.sourceUrl, sourceRecordId: `${readId(game.GameID) ?? 'game'}:${playerId}`, subjectKind: 'PLAYER', subjectId: canonicalId, claim: `${name} is listed as ${lineupStatus} for ${team} in SportsDataIO's NBA lineup feed.`, confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, retrievedAt: observedAt, payload: { gameId: readId(game.GameID) ?? null, teamId, team, playerId, name, position: readText(player.Position) ?? null, starting: typeof player.Starting === 'boolean' ? player.Starting : null, confirmed: typeof player.Confirmed === 'boolean' ? player.Confirmed : null, lineupStatus } });
            observations.push(observation);
            facts.push({ id: stableId(`fact:lineup:${readId(game.GameID)}:${playerId}:${observedAt}`), subject: { kind: 'PLAYER', id: canonicalId }, factType: 'lineup.status', value: { gameId: readId(game.GameID) ?? null, teamId: `nba:team:sportsdataio:${teamId}`, team, status: lineupStatus, confirmed, starting }, observationIds: [observation.id], confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, resolvedAt: observedAt, ruleVersion: 'street-team.lineup.v1' });
          }
        }
      }
    }

    const nbaNewsFeeds = DEFAULT_RSS_FEEDS.filter((feed) => feed.tags?.includes('NBA') && ['ESPN NBA', 'RotoWire NBA'].includes(feed.name));
    const newsResults = await Promise.all(nbaNewsFeeds.map(async (feed) => {
      const retrievedAt = this.now().toISOString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('NBA news feed timed out.')), 8_000);
      try {
        const response = await this.fetcher(feed.url, { signal: controller.signal, headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
        if (response.status === 304) return { feed, retrievedAt, articles: [], error: undefined };
        if (!response.ok) throw new Error(`${feed.name} RSS returned HTTP ${response.status}.`);
        return { feed, retrievedAt, articles: parseRss(await response.text(), feed, new Date(retrievedAt)), error: undefined };
      } catch (error) { return { feed, retrievedAt, articles: [], error }; }
      finally { clearTimeout(timeout); }
    }));
    for (const result of newsResults) {
      diagnostics.push({ provider: result.feed.name, status: result.error ? /HTTP 429/.test(errorText(result.error)) ? 'RATE_LIMITED' : 'FAILED' : result.articles.length ? 'SUCCEEDED' : 'EMPTY', retrievedAt: result.retrievedAt, freshness: result.error ? 'UNKNOWN' : 'FRESH', ...(result.error ? { errorCode: safeErrorCode(result.error) } : {}) });
      if (result.error) {
        unknowns.push({ question: `Refresh NBA context from ${result.feed.name}.`, reason: errorText(result.error).slice(0, 200) });
        continue;
      }
      for (const article of result.articles) {
        const publishedAt = article.publishedAt;
        if (publishedAt && Date.parse(publishedAt) > Date.parse(result.retrievedAt)) {
          unknowns.push({ question: 'Review an NBA news item with a future publication timestamp.', reason: 'The item was excluded from this as-of snapshot.' });
          continue;
        }
        const text = `${article.title} ${article.summary ?? ''}`;
        const matchingPlayers = [...rosterById].flatMap(([id, player]) => {
          const name = readText(player.Name) ?? joinName(player);
          return name && includesFullName(text, name) ? [`nba:player:sportsdataio:${id}`] : [];
        });
        const uniqueMatches = [...new Set(matchingPlayers)];
        if (uniqueMatches.length > 1) unknowns.push({ question: `Resolve multiple player mentions in an NBA news item from ${article.sourceName}.`, reason: 'The item is retained as league-level context because more than one roster identity matched.' });
        const newsId = stableHash(`${article.sourceName}:${article.url ?? article.title}:${publishedAt ?? ''}`);
        const sourceUrl = article.url?.startsWith('https://') ? article.url : result.feed.url;
        observations.push(makeObservation({ provider: article.sourceName, route: new URL(sourceUrl).pathname, sourceUrl, sourceRecordId: newsId, subjectKind: uniqueMatches.length === 1 ? 'PLAYER' : 'LEAGUE', subjectId: uniqueMatches.length === 1 ? uniqueMatches[0] : 'nba:league', claim: `${article.title}${article.summary ? ` — ${article.summary}` : ''}`, confidence: UNCALIBRATED_SINGLE_SOURCE_CONFIDENCE, retrievedAt: result.retrievedAt, publishedAt, payload: { title: article.title, summary: article.summary ?? null, articleUrl: article.url ?? null, publishedAt: publishedAt ?? null } }));
      }
    }

    const rosterState = facts.filter((fact) => fact.factType === 'roster.membership' || fact.factType === 'lineup.status').map((fact) => {
      if (fact.factType === 'lineup.status') {
        const value = fact.value as { teamId: string; status: string };
        return { teamId: value.teamId, playerId: fact.subject.id, status: value.status, validFrom: fact.resolvedAt, evidenceIds: fact.observationIds };
      }
      const value = fact.value as { teamId: string; providerStatus: string };
      return { teamId: value.teamId, playerId: fact.subject.id, status: value.providerStatus, validFrom: fact.resolvedAt, evidenceIds: fact.observationIds };
    });
    const availability = facts.filter((fact) => fact.factType === 'availability.injury_status').map((fact) => ({ playerId: fact.subject.id, status: String((fact.value as { normalizedStatus: string }).normalizedStatus), observedAt: fact.resolvedAt, evidenceIds: fact.observationIds }));
    const injuredPlayers = new Set(availability.filter((item) => ['OUT', 'DOUBTFUL'].includes(item.status)).map((item) => item.playerId));
    for (const lineupFact of facts.filter((fact) => fact.factType === 'lineup.status')) {
      const lineup = lineupFact.value as { status: string };
      if (injuredPlayers.has(lineupFact.subject.id) && /STARTING/i.test(lineup.status)) unknowns.push({ subjectId: lineupFact.subject.id, question: 'Resolve conflicting NBA injury and starting lineup records.', reason: 'SportsDataIO simultaneously reported an OUT/DOUBTFUL injury state and a starting lineup assignment; both source records are preserved.' });
    }
    const transactions = facts.filter((fact) => fact.factType === 'transaction.record').map((fact) => { const value = fact.value as { transactionType: string; fromTeamId?: string; toTeamId?: string; transactionDate: string }; return { playerId: fact.subject.id, transactionType: value.transactionType, effectiveAt: fact.effectiveAt ?? dateOnlyTimestamp(value.transactionDate), evidenceIds: fact.observationIds }; });
    return { rosterAvailable: rosterById.size > 0, observations, providerDiagnostics: diagnostics, unknowns, rosterState, availability, transactions, resolvedFacts: facts };
  }
}

function makeObservation(input: { provider: string; route: string; sourceUrl?: string; sourceRecordId?: string; subjectKind: NbaStreetTeamObservationInput['subjectKind']; subjectId: string; claim: string; confidence: number; retrievedAt: string; publishedAt?: string; effectiveAt?: string; payload: Record<string, unknown> }): NbaStreetTeamObservationInput {
  const hash = createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
  const hex = createHash('sha256').update(`${input.provider}:${input.route}:${input.sourceRecordId ?? input.subjectId}:${hash}:${input.retrievedAt}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const id = hex.join('');
  return { ...input, id: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`, sourceUrl: input.sourceUrl ?? `https://api.sportsdata.io/v3${input.route}`, classification: 'SINGLE_SOURCE_REPORT', observedAt: input.retrievedAt, retrievedAt: input.retrievedAt };
}
function normalizedAvailability(value: string): string { return ({ probable: 'PROBABLE', questionable: 'QUESTIONABLE', doubtful: 'DOUBTFUL', out: 'OUT' } as Record<string, string>)[value.trim().toLowerCase()] ?? 'UNKNOWN'; }
function dateOnlyTimestamp(value: string): string { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value; }
function stableHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function includesFullName(text: string, name: string): boolean { const textWords = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/); const nameWords = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/); return nameWords.join('').length >= 6 && textWords.some((_, start) => nameWords.every((word, offset) => textWords[start + offset] === word)); }
function easternFeedDate(value: Date): string { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: '2-digit' }).formatToParts(value); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''; return `${part('year')}-${part('month').toUpperCase()}-${part('day')}`; }
function asRow(value: unknown): JsonRow | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRow : undefined; }
function readText(value: unknown): string | undefined { return (typeof value === 'string' || typeof value === 'number') && String(value).trim() ? String(value).trim() : undefined; }
function readId(value: unknown): string | undefined { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || undefined : undefined; }
function joinName(row: JsonRow): string | undefined { const first = readText(row.FirstName); const last = readText(row.LastName); return first && last ? `${first} ${last}` : undefined; }
function stableId(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'provider request failed'; }
function safeErrorCode(error: unknown): string { const message = errorText(error); const status = /HTTP (\d{3})/.exec(message)?.[1]; return status ? `HTTP_${status}` : /timed? ?out|abort/i.test(message) ? 'TIMEOUT' : 'PROVIDER_ERROR'; }
