import { useEffect, useState } from 'react';
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
  const [estimatedContestDate, setEstimatedContestDate] = useState(new Date().toISOString().split('T')[0]);
  const [slateLoading, setSlateLoading] = useState(false);
  const [slateError, setSlateError] = useState<string | null>(null);
  const [excludedPlayers, setExcludedPlayers] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('balanced');

  useEffect(() => {
    const controller = new AbortController();
    setSlateLoading(true);
    setSlateError(null);
    setSlates([]);
    setSelectedContestId('');

    listDraftKingsSlates({ sport, contestType }, controller.signal)
      .then((nextSlates) => {
        setSlates(nextSlates);
        setSelectedContestId(nextSlates[0]?.contest_id ?? '');
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
    const selectedSlate = slates.find((slate) => slate.contest_id === selectedContestId) ?? (
      slates.length === 0 && !slateLoading ? buildEstimatedSlate(sport, contestType, estimatedContestDate) : null
    );
    if (!selectedSlate) {
      onValidationError?.(['Choose an imported DraftKings slate or use the estimated scan fallback.']);
      return;
    }

    const errors = validateScanInput({ sport, contestType, contestDate: selectedSlate.contest_date, riskTolerance });
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
      riskTolerance
    });
  };

  const selectedSlate = slates.find((slate) => slate.contest_id === selectedContestId);
  const canUseEstimatedScan = !slateLoading && !slateError && slates.length === 0;
  const scanDisabled = loading || slateLoading || (!selectedSlate && !canUseEstimatedScan);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Scan Settings</h2>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">Sport</label>
        <div className="grid grid-cols-2 gap-2">
          {SPORTS.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold uppercase transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
                sport === s ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-primary'
              }`}
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
        <label className="block text-sm font-medium text-gray-700 mb-3">Contest Type</label>
        <div className="grid grid-cols-2 gap-2">
          {CONTEST_TYPES.map((ct) => (
            <label
              key={ct}
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold capitalize transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
                contestType === ct ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-primary'
              }`}
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
          <label className="block text-sm font-medium text-gray-700">DraftKings Slate</label>
          {slateLoading ? <span className="rounded-full bg-info/10 px-2 py-1 text-xs font-medium text-info">Loading</span> : null}
        </div>

        {slateError ? (
          <div className="rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
            {slateError}
          </div>
        ) : null}

        {!slateLoading && !slateError && slates.length === 0 ? (
          <div className="space-y-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <p>{availabilityMessage(sport, contestType)}</p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Estimated Contest Date</span>
              <input
                type="date"
                value={estimatedContestDate}
                onChange={(e) => setEstimatedContestDate(e.target.value)}
                disabled={loading}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors duration-[var(--transition-fast)]"
              />
            </label>
          </div>
        ) : null}

        <div className="space-y-2">
          {slates.map((slate) => (
            <label
              key={slate.contest_id}
              className={`block cursor-pointer rounded-md border bg-white p-3 transition-colors duration-[var(--transition-fast)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
                selectedContestId === slate.contest_id ? 'border-primary ring-2 ring-primary/20' : 'border-gray-200 hover:border-primary'
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
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-gray-900">{slate.slate_name}</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {slate.contest_date}
                    {slate.start_time ? ` at ${formatSlateTime(slate.start_time)}` : ''}
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {slate.game_ids.length ? `${slate.game_ids.length} game${slate.game_ids.length === 1 ? '' : 's'}: ${slate.game_ids.join(', ')}` : 'Game IDs not imported'}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                  {slate.status === 'schedule_derived' ? 'Estimated salaries' : `${slate.salary_count} salaries`}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Exclude Players</label>
        <textarea
          placeholder="LeBron, Luka, Giannis (comma-separated)"
          value={excludedPlayers}
          onChange={(e) => setExcludedPlayers(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors duration-[var(--transition-fast)]"
          rows={3}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">Risk Tolerance</label>
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
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>Conservative</span>
          <span>Balanced</span>
          <span>Aggressive</span>
        </div>
      </div>

      <button
        onClick={handleScan}
        disabled={scanDisabled}
        className="w-full bg-primary hover:bg-primary-dark disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-md transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {loading ? 'Scanning...' : canUseEstimatedScan ? 'Run Estimated Scan' : 'Run Scan'}
      </button>
    </div>
  );
}

function buildEstimatedSlate(sport: string, contestType: string, contestDate: string): DraftKingsSlate {
  return {
    contest_id: `estimated-${sport}-${contestType}-${contestDate}`,
    external_contest_id: null,
    sport,
    contest_type: contestType,
    contest_date: contestDate,
    slate_name: `${sport.toUpperCase()} ${capitalize(contestType)} Estimated Slate`,
    game_ids: [],
    salary_cap: 50_000,
    status: 'estimated',
    start_time: null,
    salary_count: 0,
    data: { source: 'estimated_fallback' },
    updated_at: new Date().toISOString(),
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function availabilityMessage(sport: string, contestType: string): string {
  const label = `${sport.toUpperCase()} ${contestType}`;
  if (sport === 'nfl') {
    return `No live or near-term ${label} slates were found. NFL is outside its regular slate window, so use an estimated scan only for testing.`;
  }
  return `No live DraftKings or near-term free schedule slates were found for ${label}. You can still run an estimated scan while salary/slate data is unavailable.`;
}

function formatSlateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
