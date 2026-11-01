/** Default per-player exposure bound for the scanner's requested portfolio size. */
export function deriveMaxPlayerExposure(entryCount: number, payoutShape: string): number {
  if (entryCount <= 2 || payoutShape === 'double_up') return 1;
  if (payoutShape === 'flat') return 0.8;
  return entryCount <= 5 ? 0.6 : 0.5;
}
