import { useEffect, useRef } from 'react';
import type { Player } from '../lib/MIOS_FantasyAgents';

interface InjuryAlert {
  player: Player;
  message: string;
}

export function useInjuryAlerts(
  players: Player[],
  enabled: boolean,
  onAlert: (alert: InjuryAlert) => void
) {
  const sentRef = useRef(false);

  useEffect(() => {
    if (!enabled || sentRef.current || players.length === 0) return;

    const timer = window.setTimeout(() => {
      const player = players.find((candidate) => candidate.injury_status === 'day_to_day')
        ?? players.find((candidate) => candidate.injury_status === 'questionable')
        ?? players.find((candidate) => candidate.injury_status === 'active');

      if (!player) return;
      sentRef.current = true;
      onAlert({
        player,
        message: `${player.name} injury status changed in simulated alert feed.`
      });
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [enabled, onAlert, players]);
}
