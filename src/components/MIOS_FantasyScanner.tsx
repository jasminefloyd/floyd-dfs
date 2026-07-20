import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { SPORTS, CONTEST_TYPES } from '../lib/productConstants';
import { listDraftKingsSlates, type DraftKingsSlate } from '../lib/draftkingsSlateClient';
import { parseExcludedPlayers, validateScanInput } from '../lib/validation';

export interface ScanParams {
  sport: string;
  contestType: string;
  contestDate: string;
  contestId?: string;
  gameId?: string;
  slate: DraftKingsSlate;
  excludedPlayers: string[];
  riskTolerance: string;
  lineupMode: string;
  contestStrategy: string;
  maxPlayerExposure: number;
  maxTeamExposure: number;
  minPrimaryStack: number;
  diversifyLineups: boolean;
  lateSwapMode: boolean;
}

interface MIOS_FantasyScannerProps {
  onScan: (params: ScanParams) => void;
  loading: boolean;
  onValidationError?: (errors: string[]) => void;
}

export function MIOS_FantasyScanner({ onScan, loading, onValidationError }: MIOS_FantasyScannerProps) {
  const [sport, setSport] = useState('nba');
  const [contestType, setContestType] = useState('showdown');
  const [slates, setSlates] = useState<DraftKingsSlate[]>([]);
  const [selectedContestId, setSelectedContestId] = useState('');
  const [slateLoading, setSlateLoading] = useState(false);
  const [slateError, setSlateError] = useState<string | null>(null);
  const [excludedPlayers, setExcludedPlayers] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('balanced');
  const [lineupMode, setLineupMode] = useState('max_fpts');
  const [contestStrategy, setContestStrategy] = useState('single_entry');
  const [maxPlayerExposure, setMaxPlayerExposure] = useState(70);
  const [maxTeamExposure, setMaxTeamExposure] = useState(75);
  const [minPrimaryStack, setMinPrimaryStack] = useState(3);
  const [diversifyLineups, setDiversifyLineups] = useState(true);
  const [lateSwapMode, setLateSwapMode] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setSlateLoading(true);
    setSlateError(null);
    setSlates([]);
    setSelectedContestId('');

    listDraftKingsSlates({ sport, contestType }, controller.signal)
      .then((nextSlates) => {
        const eligibleSlates = nextSlates.filter(isWithinScanWindow);
        setSlates(eligibleSlates);
        setSelectedContestId(eligibleSlates[0]?.contest_id ?? '');
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSlateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSlateLoading(false);
      });

    return () => controller.abort();
  }, [sport, contestType]);

  const handleScan = () => {
    const selectedSlate = slates.find((slate) => slate.contest_id === selectedContestId) ?? null;
    if (!selectedSlate) {
      onValidationError?.(['Choose a DraftKings slate with verified salary data.']);
      return;
    }

    const errors = validateScanInput({ sport, contestType, contestDate: selectedSlate.contest_date, riskTolerance, lineupMode });
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
      excludedPlayers: parseExcludedPlayers(excludedPlayers),
      riskTolerance,
      lineupMode,
      contestStrategy,
      maxPlayerExposure: maxPlayerExposure / 100,
      maxTeamExposure: maxTeamExposure / 100,
      minPrimaryStack,
      diversifyLineups,
      lateSwapMode
    });
  };

  const selectedSlate = slates.find((slate) => slate.contest_id === selectedContestId);
  const scanDisabled = loading || slateLoading || !selectedSlate;
  const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow-[var(--shadow-subtle)] transition-colors duration-[var(--transition-fast)] placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30';
  const labelClass = 'block text-[11px] font-black uppercase tracking-wide text-slate-500';
  const optionClass = (active: boolean) => `flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-xs font-black uppercase transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-500 ${
    active ? 'border-[#0b1f3a] bg-[#0b1f3a] text-white shadow-[var(--shadow-subtle)]' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-500 hover:bg-cyan-50'
  }`;

  return (
    <div className="space-y-4 text-slate-900">
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-cyan-700">Build A Slate</p>
        <h2 className="mt-1 text-xl font-black text-[#0b1f3a]">Scan Settings</h2>
        <p className="mt-1 text-sm text-slate-500">Pick a sport, slate, and risk profile to generate DFS plays.</p>
      </div>

      <div>
        <label className={`mb-2 ${labelClass}`}>Sport</label>
        <div className="grid grid-cols-2 gap-2">
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
            <p>{availabilityMessage(sport, contestType)}</p>
          </div>
        ) : null}

        <div className="space-y-2">
          {slates.map((slate) => {
            const matchup = slateMatchup(slate);
            return (
              <label
                key={slate.contest_id}
                className={`block cursor-pointer rounded-md border p-3 transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-cyan-500 ${
                  selectedContestId === slate.contest_id ? 'border-[#0b1f3a] bg-blue-50 ring-2 ring-cyan-500/20' : 'border-slate-200 bg-white hover:border-cyan-500'
                }`}
              >
                <input
                  type="radio"
                  name="selectedSlate"
                  value={slate.contest_id}
                  checked={selectedContestId === slate.contest_id}
                  onChange={(e) => setSelectedContestId(e.target.value)}
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
      </div>

      <div>
        <label className={`mb-2 ${labelClass}`}>Exclude Players</label>
        <textarea
          placeholder="LeBron, Luka, Giannis (comma-separated)"
          value={excludedPlayers}
          onChange={(e) => setExcludedPlayers(e.target.value)}
          disabled={loading}
          className={`${fieldClass} font-mono`}
          rows={3}
        />
      </div>

      <div>
        <label className={`mb-2 ${labelClass}`}>Lineup Mode</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['max_fpts', 'Max FPTS'],
            ['balanced_ev', 'Balanced EV'],
            ['tournament', 'Tournament'],
            ['safe', 'Safe'],
          ].map(([mode, label]) => (
            <label
              key={mode}
              className={optionClass(lineupMode === mode)}
            >
              <input
                type="radio"
                name="lineupMode"
                value={mode}
                checked={lineupMode === mode}
                onChange={(e) => setLineupMode(e.target.value)}
                disabled={loading}
                className="sr-only"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <LabelWithTooltip label="Contest Strategy" description="Sets ranking style: safer builds favor floor and confidence, while GPP builds favor stacks, ceiling, and leverage." />
        <select
          value={contestStrategy}
          onChange={(event) => setContestStrategy(event.target.value)}
          disabled={loading}
          className={fieldClass}
        >
          <option value="cash">Cash / Safe</option>
          <option value="single_entry">Single Entry</option>
          <option value="small_field">Small Field</option>
          <option value="large_field_gpp">Large Field GPP</option>
          <option value="showdown">Showdown</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <LabelWithTooltip label="Player Exposure" description="Caps how often the same player can appear across generated lineups when diversification is enabled." />
          <input
            type="number"
            min="20"
            max="100"
            step="5"
            value={maxPlayerExposure}
            onChange={(event) => setMaxPlayerExposure(Number(event.target.value))}
            disabled={loading}
            className={fieldClass}
          />
        </div>
        <div>
          <LabelWithTooltip label="Stack Exposure" description="Caps repeated use of the same primary team stack across generated MLB lineups." side="right" />
          <input
            type="number"
            min="20"
            max="100"
            step="5"
            value={maxTeamExposure}
            onChange={(event) => setMaxTeamExposure(Number(event.target.value))}
            disabled={loading}
            className={fieldClass}
          />
        </div>
      </div>

      {sport === 'mlb' ? (
        <div>
          <label className={`mb-2 ${labelClass}`}>Primary Stack</label>
          <input
            type="range"
            min="0"
            max="5"
            step="1"
            value={minPrimaryStack}
            onChange={(event) => setMinPrimaryStack(Number(event.target.value))}
            disabled={loading}
            className="w-full accent-[#0b1f3a]"
          />
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>None</span>
            <span>{minPrimaryStack} hitters</span>
            <span>5 hitters</span>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
          <input
            type="checkbox"
            checked={diversifyLineups}
            onChange={(event) => setDiversifyLineups(event.target.checked)}
            disabled={loading}
            className="h-4 w-4 accent-[#0b1f3a]"
          />
          Diversify
          <Tooltip description="Builds a lineup set with less repeated player and stack exposure instead of five near-identical lineups." />
        </label>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
          <input
            type="checkbox"
            checked={lateSwapMode}
            onChange={(event) => setLateSwapMode(event.target.checked)}
            disabled={loading}
            className="h-4 w-4 accent-[#0b1f3a]"
          />
          Late Swap
          <Tooltip description="Flags lineup risks like unconfirmed batting orders, non-starters, and injury statuses before lock." side="right" />
        </label>
      </div>

      <div>
        <LabelWithTooltip label="Risk Tolerance" description="Controls how much the optimizer favors floor and confidence versus ceiling, variance, and leverage." />
        <input
          type="range"
          min="0"
          max="2"
          step="1"
          value={riskTolerance === 'conservative' ? 0 : riskTolerance === 'balanced' ? 1 : 2}
          onChange={(e) => {
            const mapping = ['conservative', 'balanced', 'aggressive'];
            setRiskTolerance(mapping[parseInt(e.target.value, 10)]);
          }}
          disabled={loading}
          className="w-full accent-[#0b1f3a]"
        />
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>Conservative</span>
          <span>Balanced</span>
          <span>Aggressive</span>
        </div>
      </div>

      <button
        onClick={handleScan}
        disabled={scanDisabled}
        className="w-full rounded-md bg-[#0b1f3a] px-4 py-3 font-black uppercase tracking-wide text-white shadow-[var(--shadow-medium)] transition-colors duration-[var(--transition-fast)] hover:bg-[#061426] disabled:bg-slate-300 disabled:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
      >
        {loading ? 'Scanning...' : 'Run Scan'}
      </button>
    </div>
  );
}

function isWithinScanWindow(slate: DraftKingsSlate): boolean {
  const rawValue = slate.start_time ?? `${slate.contest_date}T00:00:00`;
  const startTime = new Date(rawValue);
  if (Number.isNaN(startTime.getTime())) return false;

  const now = new Date();
  const latestAllowedTime = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  return startTime >= now && startTime <= latestAllowedTime;
}

function availabilityMessage(sport: string, contestType: string): string {
  const label = `${sport.toUpperCase()} ${contestType}`;
  return `No DraftKings ${label} slates with verified salary data were found for the next 48 hours.`;
}

function LabelWithTooltip({ label, description, side = 'center' }: { label: string; description: string; side?: TooltipSide }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <label className="block text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</label>
      <Tooltip description={description} side={side} />
    </div>
  );
}

type TooltipSide = 'center' | 'right';

function Tooltip({ description, side = 'center' }: { description: string; side?: TooltipSide }) {
  const bubblePosition = side === 'right'
    ? 'right-0 top-6'
    : 'left-1/2 top-6 -translate-x-1/2';

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={description}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#0b1f3a] focus-visible:bg-slate-100 focus-visible:text-[#0b1f3a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span className={`pointer-events-none absolute ${bubblePosition} z-20 hidden w-[min(14rem,calc(100vw-2rem))] rounded-md border border-slate-700 bg-[#0b1f3a] px-3 py-2 text-[11px] font-medium leading-snug text-white shadow-[var(--shadow-medium)] group-hover:block group-focus-within:block`}>
        {description}
      </span>
    </span>
  );
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
    f1: 'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',
  };
  return logos[sport];
}

function slateMatchup(slate: DraftKingsSlate): { label: string; teams: SlateTeam[] } {
  const teams = slateTeams(slate);
  if (teams.length >= 2) {
    return {
      label: `${teamLabel(teams[0])} vs ${teamLabel(teams[1])}`,
      teams,
    };
  }
  return {
    label: slate.slate_name,
    teams,
  };
}

function slateTeams(slate: DraftKingsSlate): SlateTeam[] {
  const data = slate.data as Record<string, any> | undefined;
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

function salaryStatusLabel(slate: DraftKingsSlate): 'Live' | 'Projected' {
  const data = slate.data as Record<string, unknown> | undefined;
  return slate.status === 'draftkings_live' && slate.salary_count > 0 && data?.source === 'draftkings_unofficial_json'
    ? 'Live'
    : 'Projected';
}
