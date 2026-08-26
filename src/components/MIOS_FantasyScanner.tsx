import { useEffect, useRef, useState } from 'react';
import { SPORTS, CONTEST_TYPES } from '../lib/productConstants';
import { listDraftKingsGameGroups, listDraftKingsSlates, type DraftKingsGameGroup, type DraftKingsSlate } from '../lib/draftkingsSlateClient';
import { validateScanInput } from '../lib/validation';

export interface ScanParams {
  sport: string;
  contestType: string;
  contestDate: string;
  contestId?: string;
  gameId?: string;
  slate: DraftKingsSlate;
  excludedPlayers: string[];
  lockedPlayers: string[];
  riskTolerance: string;
  lineupMode: string;
  contestStrategy: string;
  maxPlayerExposure: number;
  maxTeamExposure: number;
  minPrimaryStack: number;
  diversifyLineups: boolean;
  lateSwapMode: boolean;
  entryCount: number;
  fieldSize: number;
  maxEntriesPerUser: number;
  payoutShape: string;
  ownershipWeight: number;
  correlationWeight: number;
  maxCaptainExposure: number;
  captainPool: string[];
  minPerTeam: number;
  forceUniqueCaptains: boolean;
  minSalaryUsed: number;
  maxDuplication: number;
  maxSharedPlayers?: number;
  simulationIterations: number;
  fieldSimulationSize: number;
  showDiagnostics: boolean;
}

interface MIOS_FantasyScannerProps {
  onScan: (params: ScanParams) => void;
  loading: boolean;
  loadingLabel?: string;
  onValidationError?: (errors: string[]) => void;
}

const DEFAULT_SCAN_OPTIONS = {
  riskTolerance: 'balanced',
  lineupMode: defaultLineupMode('top_heavy'),
  maxPlayerExposure: 0.8,
  maxTeamExposure: 1,
  minPrimaryStack: 0,
  diversifyLineups: true,
  lateSwapMode: true,
  entryCount: 1,
  fieldSize: 500,
  maxEntriesPerUser: 3,
  payoutShape: 'top_heavy',
  ownershipWeight: 0.9,
  correlationWeight: 1,
  maxCaptainExposure: 0.4,
  minPerTeam: 1,
  forceUniqueCaptains: true,
  minSalaryUsed: 49_000,
  maxDuplication: 25,
  maxSharedPlayers: undefined,
  simulationIterations: 1_000,
  fieldSimulationSize: 240,
  showDiagnostics: false,
};

const PAYOUT_SHAPES = [
  { value: 'top_heavy', label: 'Top Heavy' },
  { value: 'flat', label: 'Flat' },
  { value: 'winner_take_all', label: 'Winner Take All' },
  { value: 'double_up', label: 'Double Up' },
];

const SLATES_PER_PAGE = 7;

export function MIOS_FantasyScanner({ onScan, loading, loadingLabel, onValidationError }: MIOS_FantasyScannerProps) {
  const [sport, setSport] = useState('nba');
  const [contestType, setContestType] = useState('showdown');
  const [groups, setGroups] = useState<DraftKingsGameGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [slates, setSlates] = useState<DraftKingsSlate[]>([]);
  const [selectedContestId, setSelectedContestId] = useState('');
  const selectedContestIdRef = useRef('');
  const [slateLoading, setSlateLoading] = useState(false);
  const [slateError, setSlateError] = useState<string | null>(null);
  const [slatePage, setSlatePage] = useState(1);
  const [entryCount, setEntryCount] = useState(DEFAULT_SCAN_OPTIONS.entryCount);
  const [fieldSize, setFieldSize] = useState(DEFAULT_SCAN_OPTIONS.fieldSize);
  const [payoutShape, setPayoutShape] = useState(DEFAULT_SCAN_OPTIONS.payoutShape);
  const [lineupMode, setLineupMode] = useState(DEFAULT_SCAN_OPTIONS.lineupMode);
  const [maxSharedPlayers, setMaxSharedPlayers] = useState<number | ''>('');
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    setConfigLoaded(false);
    const saved = readSavedConfig(configStorageKey(sport, contestType));
    if (saved) applySavedConfig(saved);
    else applySavedConfig(DEFAULT_SCAN_OPTIONS);
    setConfigLoaded(true);
  }, [sport, contestType]);

  useEffect(() => {
    if (!configLoaded) return;
    writeSavedConfig(configStorageKey(sport, contestType), {
      entryCount,
      fieldSize,
      payoutShape,
      lineupMode,
      maxSharedPlayers,
    });
  }, [
    sport,
    contestType,
    configLoaded,
    entryCount,
    fieldSize,
    payoutShape,
    lineupMode,
    maxSharedPlayers,
  ]);

  function applySavedConfig(config: Partial<typeof DEFAULT_SCAN_OPTIONS> & Record<string, unknown>) {
    setEntryCount(numberOrDefault(config.entryCount, DEFAULT_SCAN_OPTIONS.entryCount));
    setFieldSize(numberOrDefault(config.fieldSize, DEFAULT_SCAN_OPTIONS.fieldSize));
    setPayoutShape(typeof config.payoutShape === 'string' ? config.payoutShape : DEFAULT_SCAN_OPTIONS.payoutShape);
    setLineupMode(typeof config.lineupMode === 'string' ? config.lineupMode : DEFAULT_SCAN_OPTIONS.lineupMode);
    setMaxSharedPlayers(Number.isInteger(Number(config.maxSharedPlayers)) ? Number(config.maxSharedPlayers) : '');
  }

  function selectSlate(contestId: string, availableSlates = slates) {
    selectedContestIdRef.current = contestId;
    setSelectedContestId(contestId);
    if (!contestId) return;
    const slate = availableSlates.find((item) => item.contest_id === contestId);
    if (slate?.field_size !== undefined) setFieldSize(slate.field_size);
  }

  // Step 1 of the picker funnel: which game (DraftKings draft group) is this? A game can have
  // 50+ individual DK contests behind it, so this narrows the field before the user ever sees a
  // slate list. Re-fetches whenever sport or contest type changes; auto-selects the first game,
  // mirroring the same "sensible default, user can override" convention the slate step already
  // used before this step existed.
  useEffect(() => {
    const controller = new AbortController();
    setGroupLoading(true);
    setGroupError(null);
    setGroups([]);
    setSelectedGroupId('');

    listDraftKingsGameGroups({ sport, contestType }, controller.signal)
      .then((nextGroups) => {
        setGroups(nextGroups);
        setSelectedGroupId(nextGroups[0]?.draftGroupId ?? '');
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setGroupError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setGroupLoading(false);
      });

    return () => controller.abort();
  }, [sport, contestType]);

  // Step 2: once a game is selected, list only the DK contests for that specific game (still an
  // explicit pick — selecting one auto-populates Field Size below, unchanged from before this
  // step existed). Deliberately does not fetch until a group is selected, so switching sport/
  // contest type doesn't briefly show the previous game's slates.
  useEffect(() => {
    const controller = new AbortController();
    setSlates([]);
    selectedContestIdRef.current = '';
    setSelectedContestId('');
    setSlatePage(1);
    if (!selectedGroupId) { setSlateLoading(false); setSlateError(null); return; }
    setSlateLoading(true);
    setSlateError(null);

    listDraftKingsSlates({ sport, contestType, draftGroupId: selectedGroupId }, controller.signal)
      .then((nextSlates) => {
        const eligibleSlates = nextSlates.filter(isWithinScanWindow);
        setSlates(eligibleSlates);
        const firstSlate = eligibleSlates[0];
        selectSlate(firstSlate?.contest_id ?? '', eligibleSlates);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSlateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSlateLoading(false);
      });

    return () => controller.abort();
  }, [sport, contestType, selectedGroupId]);

  const handleScan = () => {
    const selectedSlate = slates.find((slate) => slate.contest_id === selectedContestId) ?? null;
    if (!selectedSlate) {
      onValidationError?.(['Choose a DraftKings slate with verified salary data.']);
      return;
    }

    const derived = deriveScanOptions({
      contestType,
      entryCount,
      fieldSize,
    payoutShape,
    lineupMode,
    maxSharedPlayers,
      sport,
    });
    const errors = validateScanInput({
      sport,
      contestType,
      contestDate: selectedSlate.contest_date,
      contestStartTime: selectedSlate.start_time,
      riskTolerance: derived.riskTolerance,
      lineupMode: derived.lineupMode,
      entryCount,
      fieldSize,
      maxEntriesPerUser: derived.maxEntriesPerUser,
      payoutShape,
      maxCaptainExposure: derived.maxCaptainExposure,
      lockedPlayers: [],
      excludedPlayers: [],
      captainPool: [],
      minPerTeam: derived.minPerTeam,
      rosterSize: contestType === 'showdown' ? 6 : classicRosterSize(sport),
      minSalaryUsed: derived.minSalaryUsed,
      maxSharedPlayers: derived.maxSharedPlayers,
    });
    if (errors.length) {
      onValidationError?.(errors);
      return;
    }

    onScan({
      sport,
      contestType,
      contestDate: selectedSlate.contest_date,
      contestId: selectedSlate.status === 'estimated' ? undefined : selectedSlate.contest_id,
      gameId: selectedSlate.game_ids[0],
      slate: selectedSlate,
      excludedPlayers: [],
      lockedPlayers: [],
      riskTolerance: derived.riskTolerance,
      lineupMode: derived.lineupMode,
      contestStrategy: derived.contestStrategy,
      maxPlayerExposure: derived.maxPlayerExposure,
      maxTeamExposure: derived.maxTeamExposure,
      minPrimaryStack: derived.minPrimaryStack,
      diversifyLineups: true,
      lateSwapMode: DEFAULT_SCAN_OPTIONS.lateSwapMode,
      entryCount,
      fieldSize,
      maxEntriesPerUser: derived.maxEntriesPerUser,
      payoutShape,
      ownershipWeight: derived.ownershipWeight,
      correlationWeight: derived.correlationWeight,
      maxCaptainExposure: derived.maxCaptainExposure,
      captainPool: [],
      minPerTeam: derived.minPerTeam,
      forceUniqueCaptains: derived.forceUniqueCaptains,
      minSalaryUsed: derived.minSalaryUsed,
      maxDuplication: derived.maxDuplication,
      maxSharedPlayers: derived.maxSharedPlayers,
      simulationIterations: derived.simulationIterations,
      fieldSimulationSize: derived.fieldSimulationSize,
      showDiagnostics: false,
    });
  };

  const selectedSlate = slates.find((slate) => slate.contest_id === selectedContestId);
  const slatePageCount = Math.max(1, Math.ceil(slates.length / SLATES_PER_PAGE));
  const visibleSlates = slates.slice((slatePage - 1) * SLATES_PER_PAGE, slatePage * SLATES_PER_PAGE);
  const scanDisabled = loading || groupLoading || slateLoading || !selectedSlate;
  const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-[var(--shadow-subtle)] transition-colors duration-[var(--transition-fast)] placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30';
  const labelClass = 'block text-[11px] font-black uppercase tracking-wide text-slate-500';
  const optionClass = (active: boolean) => `flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-xs font-black uppercase transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-500 ${
    active ? 'border-[#0b1f3a] bg-[#0b1f3a] text-white shadow-[var(--shadow-subtle)]' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-500 hover:bg-cyan-50'
  }`;

  return (
    <div className="space-y-4 text-slate-900">
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-cyan-700">Build A Slate</p>
        <h2 className="mt-1 text-xl font-black text-[#0b1f3a]">Build Tournament Lineups</h2>
        <p className="mt-1 text-sm text-slate-500">Pick a sport, contest type, slate, and payout goal.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label>
          <span className={labelClass}>Entries</span>
          <input
            type="number"
            min={1}
            max={20}
            value={entryCount}
            onChange={(event) => setEntryCount(Number(event.target.value))}
            disabled={loading}
            className={fieldClass}
          />
        </label>
        <label className="col-span-2">
          <span className={labelClass}>Field Size</span>
          <input
            type="number"
            min={2}
            max={500000}
            value={fieldSize}
            onChange={(event) => setFieldSize(Number(event.target.value))}
            disabled={loading}
            className={fieldClass}
          />
        </label>
      </div>

      <div>
        <label className={`mb-2 ${labelClass}`}>Payout Shape</label>
        <select
          value={payoutShape}
          onChange={(event) => setPayoutShape(event.target.value)}
          disabled={loading}
          className={fieldClass}
        >
          {PAYOUT_SHAPES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={labelClass}>Objective</span>
          <select
            value={lineupMode}
            onChange={(event) => setLineupMode(event.target.value)}
            disabled={loading}
            className={fieldClass}
          >
            <option value="max_fpts">Max Fantasy Points</option>
            <option value="tournament">Tournament EV</option>
            <option value="balanced_ev">Balanced EV</option>
            <option value="safe">Cash / Safe</option>
          </select>
        </label>
        <label>
          <span className={labelClass}>Max Shared Players</span>
          <input
            type="number"
            min={0}
            max={10}
            placeholder="No limit"
            value={maxSharedPlayers}
            onChange={(event) => setMaxSharedPlayers(event.target.value === '' ? '' : Number(event.target.value))}
            disabled={loading}
            className={fieldClass}
          />
        </label>
      </div>

      <div>
        <label className={`mb-2 ${labelClass}`}>Sport</label>
        {/* An odd sport count (e.g. adding golf as the 5th) leaves the last button alone
            in the left column with empty space beside it -- span it full width instead. */}
        <div className="grid grid-cols-2 gap-2 [&>label:last-child:nth-child(odd)]:col-span-2">
          {SPORTS.map((s) => (
            <label
              key={s}
              className={optionClass(sport === s)}
            >
              <input
                type="radio"
                name="sport"
                value={s}
                checked={sport === s}
                onChange={(e) => setSport(e.target.value)}
                disabled={loading}
                className="sr-only"
              />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className={`mb-2 ${labelClass}`}>Contest Type</label>
        <div className="grid grid-cols-2 gap-2">
          {CONTEST_TYPES.map((ct) => (
            <label
              key={ct}
              className={optionClass(contestType === ct)}
            >
              <input
                type="radio"
                name="contestType"
                value={ct}
                checked={contestType === ct}
                onChange={(e) => setContestType(e.target.value)}
                disabled={loading}
                className="sr-only"
              />
              <span>{ct}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="block text-[11px] font-black uppercase tracking-wide text-slate-500">Game</label>
          {groupLoading ? <span className="rounded-md border border-cyan-500/30 bg-cyan-50 px-2 py-1 text-xs font-black text-cyan-800">Loading</span> : null}
        </div>

        {groupError ? (
          <div className="rounded-md border border-error/30 bg-red-50 p-3 text-sm font-medium text-error">
            {groupError}
          </div>
        ) : null}

        {!groupLoading && !groupError && groups.length === 0 ? (
          <div className="rounded-md border border-warning/30 bg-amber-50 p-3 text-sm font-medium text-warning">
            <p>{availabilityMessage(sport, contestType)}</p>
          </div>
        ) : null}

        <div className="space-y-2">
          {groups.map((group) => (
            <label
              key={group.draftGroupId}
              onClick={() => setSelectedGroupId(group.draftGroupId)}
              className={`block cursor-pointer rounded-md border p-3 transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-500 ${
                selectedGroupId === group.draftGroupId ? 'border-[#0b1f3a] bg-blue-50 ring-2 ring-cyan-500/20' : 'border-slate-200 bg-white hover:border-cyan-500'
              }`}
            >
              <input
                type="radio"
                name="selectedGroup"
                value={group.draftGroupId}
                checked={selectedGroupId === group.draftGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                disabled={loading}
                className="sr-only"
              />
              <span className="block text-sm font-black text-[#0b1f3a]">{group.matchupLabel}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="block text-[11px] font-black uppercase tracking-wide text-slate-500">DraftKings Slate</label>
          {slateLoading ? <span className="rounded-md border border-cyan-500/30 bg-cyan-50 px-2 py-1 text-xs font-black text-cyan-800">Loading</span> : null}
        </div>

        {slateError ? (
          <div className="rounded-md border border-error/30 bg-red-50 p-3 text-sm font-medium text-error">
            {slateError}
          </div>
        ) : null}

        {!slateLoading && !slateError && slates.length === 0 ? (
          <div className="rounded-md border border-warning/30 bg-amber-50 p-3 text-sm font-medium text-warning">
            <p>{selectedGroupId ? 'No DraftKings contests were found for this game.' : 'Choose a game above to see its contests.'}</p>
          </div>
        ) : null}

        <div className="space-y-2">
          {visibleSlates.map((slate) => {
            const matchup = slateMatchup(slate);
            return (
              <label
                key={slate.contest_id}
                onClick={() => selectSlate(slate.contest_id)}
                className={`block cursor-pointer rounded-md border p-3 transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-500 ${
                  selectedContestId === slate.contest_id ? 'border-[#0b1f3a] bg-blue-50 ring-2 ring-cyan-500/20' : 'border-slate-200 bg-white hover:border-cyan-500'
                }`}
              >
                <input
                  type="radio"
                  name="selectedSlate"
                  value={slate.contest_id}
                  checked={selectedContestId === slate.contest_id}
                  onChange={(e) => selectSlate(e.target.value)}
                  disabled={loading}
                  className="sr-only"
                />
                <span className="block">
                  <span className="flex items-start gap-3">
                    <MatchupMark sport={sport} teams={matchup.teams} fallbackLogoUrl={slateSportLogoUrl(slate)} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-black leading-tight text-[#0b1f3a]">{matchup.label}</span>
                      <span className="mt-1 block text-xs font-medium text-slate-500">
                        {formatSlateDateTime(slate.start_time ?? slate.contest_date)}
                      </span>
                    </span>
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-2 pl-14">
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">
                      {salaryStatusLabel(slate)}
                    </span>
                    <span className="min-w-0 break-words text-xs text-slate-500">
                      {slate.game_ids.length ? `${slate.game_ids.length} game${slate.game_ids.length === 1 ? '' : 's'}: ${slate.game_ids.join(', ')}` : 'Game IDs not imported'}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {slates.length > SLATES_PER_PAGE ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <button
              type="button"
              onClick={() => setSlatePage((page) => Math.max(1, page - 1))}
              disabled={slatePage === 1 || loading}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs font-black text-slate-500">Page {slatePage} of {slatePageCount}</span>
            <button
              type="button"
              onClick={() => setSlatePage((page) => Math.min(slatePageCount, page + 1))}
              disabled={slatePage === slatePageCount || loading}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      <button
        onClick={handleScan}
        disabled={scanDisabled}
        className="w-full rounded-md bg-[#0b1f3a] px-4 py-3 font-black uppercase tracking-wide text-white shadow-[var(--shadow-medium)] transition-colors duration-[var(--transition-fast)] hover:bg-[#061426] disabled:bg-slate-300 disabled:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
      >
        {loading ? (loadingLabel ?? 'Scanning...') : 'Run Scan'}
      </button>
    </div>
  );
}

function isWithinScanWindow(slate: DraftKingsSlate): boolean {
  const rawValue = slate.start_time ?? `${slate.contest_date}T00:00:00`;
  const startTime = new Date(rawValue);
  if (Number.isNaN(startTime.getTime())) return false;

  const now = new Date();
  const latestAllowedTime = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  return startTime >= now && startTime <= latestAllowedTime;
}

function availabilityMessage(sport: string, contestType: string): string {
  const label = `${sport.toUpperCase()} ${contestType}`;
  return `No DraftKings ${label} contests were found for the next 3 days.`;
}

function formatSlateDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).toLowerCase();
  return `${datePart} at ${timePart}`;
}

interface SlateTeam {
  abbreviation?: string | null;
  display_name?: string | null;
  logo_url?: string | null;
}

function MatchupMark({ sport, teams, fallbackLogoUrl }: { sport: string; teams: SlateTeam[]; fallbackLogoUrl?: string }) {
  const logos = teams.map((team) => team.logo_url).filter((url): url is string => Boolean(url)).slice(0, 2);
  if (logos.length) {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center -space-x-3 rounded-md border border-cyan-200 bg-white p-1">
        {logos.map((logoUrl) => (
          <img
            key={logoUrl}
            src={logoUrl}
            alt=""
            className="h-7 w-7 rounded-full border border-white bg-white object-contain shadow-[var(--shadow-subtle)]"
          />
        ))}
      </span>
    );
  }

  if (fallbackLogoUrl) {
    return (
      <img
        src={fallbackLogoUrl}
        alt=""
        className="h-11 w-11 shrink-0 rounded-md border border-cyan-200 bg-white object-contain p-1"
      />
    );
  }

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-cyan-200 bg-cyan-50 text-sm font-black text-cyan-800">
      {sport.slice(0, 3).toUpperCase()}
    </span>
  );
}

function slateSportLogoUrl(slate: DraftKingsSlate): string | undefined {
  const data = slate.data as Record<string, unknown> | undefined;
  return typeof data?.sport_logo_url === 'string' ? data.sport_logo_url : sportLogoFallback(slate.sport);
}

function sportLogoFallback(sport: string): string | undefined {
  const logos: Record<string, string> = {
    nba: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png',
    wnba: 'https://a.espncdn.com/i/teamlogos/leagues/500/wnba.png',
    mlb: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png',
    nfl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png',
  };
  return logos[sport];
}

function slateMatchup(slate: DraftKingsSlate): { label: string; teams: SlateTeam[] } {
  const teams = slateTeams(slate);
  // Golf (and anything else with no real opposing teams) reports two identical
  // placeholder "teams", which would otherwise render as a meaningless "Golf vs Golf"
  // that can't distinguish one slate from another.
  if (teams.length >= 2 && teamLabel(teams[0]) !== teamLabel(teams[1])) {
    return {
      label: slate.slate_name,
      teams,
    };
  }
  return {
    label: slateEventName(slate) ?? slate.slate_name,
    teams,
  };
}

function slateEventName(slate: DraftKingsSlate): string | null {
  const data = slate.data as Record<string, any> | undefined;
  const competition = Array.isArray(data?.competitions) ? data.competitions[0] : undefined;
  return typeof competition?.name === 'string' && competition.name.trim() ? competition.name.trim() : null;
}

function slateTeams(slate: DraftKingsSlate): SlateTeam[] {
  const data = slate.data as Record<string, any> | undefined;
  const matchup = data?.matchup as Record<string, unknown> | null | undefined;
  if (matchup?.away || matchup?.home) {
    return [matchup.away, matchup.home]
      .filter((team): team is string => typeof team === 'string' && team.length > 0)
      .map((team) => ({ abbreviation: team, display_name: team, logo_url: teamLogoFallback(slate.sport, team) }));
  }
  const competition = Array.isArray(data?.competitions) ? data.competitions[0] : undefined;
  if (competition?.awayTeam || competition?.homeTeam) {
    return [competition.awayTeam, competition.homeTeam]
      .filter(Boolean)
      .map((team: Record<string, unknown>) => ({
        abbreviation: typeof team.abbreviation === 'string' ? team.abbreviation : null,
        display_name: team.teamName && team.city ? `${team.city} ${team.teamName}` : typeof team.teamName === 'string' ? team.teamName : null,
        logo_url: typeof team.teamImageUrl === 'string' ? team.teamImageUrl : null,
      }));
  }

  const events = Array.isArray(data?.events) ? data.events : data?.event ? [data.event] : [];
  const eventTeams = events.flatMap((event) => Array.isArray(event?.teams) ? event.teams : []);
  return eventTeams.map((team: Record<string, unknown>) => ({
    abbreviation: typeof team.abbreviation === 'string' ? team.abbreviation : null,
    display_name: typeof team.display_name === 'string' ? team.display_name : null,
    logo_url: typeof team.logo_url === 'string' ? team.logo_url : null,
  }));
}

function teamLabel(team: SlateTeam): string {
  return team.abbreviation || team.display_name || 'Team';
}

function teamLogoFallback(sport: string, team: string): string | undefined {
  const league = sport.toLowerCase();
  const abbreviation = team.trim().toLowerCase();
  return abbreviation && ['nba', 'wnba', 'mlb', 'nfl'].includes(league)
    ? `https://a.espncdn.com/i/teamlogos/${league}/500/${abbreviation}.png`
    : undefined;
}

function salaryStatusLabel(slate: DraftKingsSlate): 'Live' | 'Projected' {
  const data = slate.data as Record<string, unknown> | undefined;
  return slate.status === 'draftkings_live' && slate.salary_count > 0 && data?.source === 'draftkings_unofficial_json'
    ? 'Live'
    : 'Projected';
}

function configStorageKey(sport: string, contestType: string): string {
  return `fantasy-ai.scan-config.${sport}.${contestType}`;
}

function readSavedConfig(key: string): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function writeSavedConfig(key: string, config: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(config));
}

function numberOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function classicRosterSize(sport: string): number {
  if (sport === 'wnba') return 6;
  if (sport === 'nfl') return 9;
  if (sport === 'mlb') return 10;
  if (sport === 'golf') return 6;
  return 8;
}

function defaultLineupMode(shape: string): string {
  return shape === 'double_up' ? 'safe' : 'tournament';
}

interface DerivedScanInput {
  contestType: string;
  entryCount: number;
  fieldSize: number;
  payoutShape: string;
  lineupMode: string;
  maxSharedPlayers: number | '';
  sport: string;
}

function deriveScanOptions(input: DerivedScanInput) {
  const lineupMode = input.lineupMode;
  const maxEntriesPerUser = Math.min(150, Math.max(1, input.entryCount));
  const maxPlayerExposure = input.entryCount <= 1
    ? 1
    : input.payoutShape === 'double_up'
      ? 1
      : input.payoutShape === 'flat'
        ? 0.8
        : input.entryCount <= 5
          ? 0.6
          : 0.5;
  const contestStrategy = deriveContestStrategy(input.fieldSize, input.payoutShape, maxEntriesPerUser, lineupMode);
  const simulationIterations = input.sport === 'mlb' && input.contestType === 'classic'
    ? input.entryCount > 1 ? 500 : 650
    : input.fieldSize >= 10_000
      ? 750
      : DEFAULT_SCAN_OPTIONS.simulationIterations;
  const fieldSimulationSize = input.sport === 'mlb' && input.contestType === 'classic'
    ? input.entryCount > 1 ? 180 : 220
    : Math.min(360, Math.max(120, input.fieldSize));

  return {
    riskTolerance: DEFAULT_SCAN_OPTIONS.riskTolerance,
    lineupMode,
    contestStrategy,
    maxPlayerExposure,
    maxTeamExposure: input.contestType === 'showdown' ? DEFAULT_SCAN_OPTIONS.maxTeamExposure : maxPlayerExposure,
    minPrimaryStack: input.sport === 'mlb' && input.contestType === 'classic' && input.payoutShape !== 'double_up' && lineupMode !== 'max_fpts' ? 3 : DEFAULT_SCAN_OPTIONS.minPrimaryStack,
    maxEntriesPerUser,
    ownershipWeight: ownershipWeightForContest(input.fieldSize, input.payoutShape, maxEntriesPerUser),
    correlationWeight: DEFAULT_SCAN_OPTIONS.correlationWeight,
    maxCaptainExposure: input.contestType === 'showdown' && input.entryCount > 1 ? Math.max(1 / input.entryCount, maxPlayerExposure / 2) : 1,
    minPerTeam: DEFAULT_SCAN_OPTIONS.minPerTeam,
    forceUniqueCaptains: input.contestType === 'showdown' && input.entryCount > 1 && input.entryCount <= 5 && input.payoutShape !== 'double_up',
    minSalaryUsed: input.contestType === 'showdown' && lineupMode !== 'max_fpts' ? DEFAULT_SCAN_OPTIONS.minSalaryUsed : 0,
    maxDuplication: input.payoutShape === 'winner_take_all' ? 5 : input.payoutShape === 'double_up' ? 500 : DEFAULT_SCAN_OPTIONS.maxDuplication,
    maxSharedPlayers: input.maxSharedPlayers === '' ? undefined : input.maxSharedPlayers,
    simulationIterations,
    fieldSimulationSize,
  };
}

function ownershipWeightForContest(fieldSize: number, payoutShape: string, maxEntriesPerUser: number): number {
  const fieldComponent = fieldSize >= 10_000 ? 1.2 : fieldSize >= 1_000 ? 0.8 : fieldSize >= 100 ? 0.45 : 0.15;
  const payoutComponent = payoutShape === 'winner_take_all' ? 0.6 : payoutShape === 'top_heavy' ? 0.35 : payoutShape === 'double_up' ? -0.2 : 0;
  const entryComponent = maxEntriesPerUser >= 20 ? 0.2 : maxEntriesPerUser >= 3 ? 0.1 : 0;
  return Math.min(Math.max(Number((fieldComponent + payoutComponent + entryComponent).toFixed(2)), 0), 2);
}

function deriveContestStrategy(fieldSize: number, payoutShape: string, maxEntriesPerUser: number, lineupMode: string): string {
  if (lineupMode === 'safe' || payoutShape === 'double_up') return 'cash';
  if (fieldSize >= 5_000 || maxEntriesPerUser >= 20 || payoutShape === 'winner_take_all') return 'large_field_gpp';
  if (fieldSize >= 500 || maxEntriesPerUser > 1 || payoutShape === 'top_heavy') return 'small_field';
  return 'single_entry';
}
