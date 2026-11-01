export const SCOUT_WORK_UNITS = ['ROSTER', 'INJURY', 'ROTATION', 'STATISTICAL_TREND', 'REST_TRAVEL', 'FORMER_TEAM', 'COACHING', 'PLAYOFF_CONTEXT', 'BEHAVIORAL_NEWS'] as const;
export type ScoutWorkUnit = typeof SCOUT_WORK_UNITS[number];

export function scoutWorkUnits(provider: string, route: string, claim: string): ScoutWorkUnit[] {
  const text = `${route} ${claim}`.toLowerCase();
  const units = new Set<ScoutWorkUnit>();
  if (/\/scores\/json\/players(?:\/|$)|roster|team assignment|transaction/.test(text)) units.add('ROSTER');
  if (/injur|questionable|doubtful|out|availability/.test(text)) units.add('INJURY');
  if (/lineup|starter|rotation|minutes/.test(text)) units.add('ROTATION');
  if (/statistics|statistical trend|box score|points|rebounds|assists|shooting|trend/.test(text)) units.add('STATISTICAL_TREND');
  if (/rest|travel|back.to.back/.test(text)) units.add('REST_TRAVEL');
  if (/former team|revenge|return to/.test(text)) units.add('FORMER_TEAM');
  if (/coach|coaching/.test(text)) units.add('COACHING');
  if (/playoff|postseason/.test(text)) units.add('PLAYOFF_CONTEXT');
  if (provider !== 'SportsDataIO' && !units.size) units.add('BEHAVIORAL_NEWS');
  return [...units];
}
