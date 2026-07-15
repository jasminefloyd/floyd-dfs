import { useState } from 'react';
import { SPORTS, CONTEST_TYPES } from '../lib/productConstants';

export interface ScanParams {
  sport: string;
  contestType: string;
  contestDate: string;
  excludedPlayers: string[];
  riskTolerance: string;
}

interface MIOS_FantasyScannerProps {
  onScan: (params: ScanParams) => void;
  loading: boolean;
}

export function MIOS_FantasyScanner({ onScan, loading }: MIOS_FantasyScannerProps) {
  const [sport, setSport] = useState('nba');
  const [contestType, setContestType] = useState('showdown');
  const [contestDate, setContestDate] = useState(new Date().toISOString().split('T')[0]);
  const [excludedPlayers, setExcludedPlayers] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('balanced');

  const handleScan = () => {
    onScan({
      sport,
      contestType,
      contestDate,
      excludedPlayers: excludedPlayers.split(',').map((p) => p.trim()).filter(Boolean),
      riskTolerance
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Scan Settings</h2>

      {/* Sport Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">Sport</label>
        <div className="space-y-2">
          {SPORTS.map((s) => (
            <label key={s} className="flex items-center">
              <input
                type="radio"
                name="sport"
                value={s}
                checked={sport === s}
                onChange={(e) => setSport(e.target.value)}
                disabled={loading}
                className="h-4 w-4 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              <span className="ml-2 text-gray-700 uppercase">{s}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Contest Type Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">Contest Type</label>
        <div className="space-y-2">
          {CONTEST_TYPES.map((ct) => (
            <label key={ct} className="flex items-center">
              <input
                type="radio"
                name="contestType"
                value={ct}
                checked={contestType === ct}
                onChange={(e) => setContestType(e.target.value)}
                disabled={loading}
                className="h-4 w-4 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              <span className="ml-2 text-gray-700 capitalize">{ct}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Date Picker */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Contest Date</label>
        <input
          type="date"
          value={contestDate}
          onChange={(e) => setContestDate(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors duration-[var(--transition-fast)]"
        />
      </div>

      {/* Excluded Players */}
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

      {/* Risk Tolerance */}
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

      {/* Scan Button */}
      <button
        onClick={handleScan}
        disabled={loading}
        className="w-full bg-primary hover:bg-primary-dark disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-md transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {loading ? 'Scanning...' : 'SCAN NOW'}
      </button>
    </div>
  );
}
