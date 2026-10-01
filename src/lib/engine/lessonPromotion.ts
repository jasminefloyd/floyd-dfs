export type LessonStatus = 'OBSERVED' | 'ACCUMULATING' | 'VALIDATED' | 'REJECTED';
export interface PromotionInput { status: LessonStatus; sampleCount: number; independentContests: number; hasMetrics: boolean; humanApproved: boolean; }
export interface PromotionDecision { status: LessonStatus; promotable: boolean; reason: string; }

/** Model changes require repeated, independent measured evidence and explicit review. */
export function evaluateLessonPromotion(input: PromotionInput): PromotionDecision {
  if (input.status === 'REJECTED') return { status: 'REJECTED', promotable: false, reason: 'Lesson was rejected and cannot be promoted automatically.' };
  if (!input.humanApproved) return { status: input.sampleCount >= 3 ? 'ACCUMULATING' : 'OBSERVED', promotable: false, reason: 'Human review is required before a lesson becomes a model rule.' };
  if (input.sampleCount < 3 || input.independentContests < 2 || !input.hasMetrics) return { status: input.sampleCount >= 3 ? 'ACCUMULATING' : 'OBSERVED', promotable: false, reason: 'At least 3 observations, 2 independent contests, and calibration metrics are required.' };
  return { status: 'VALIDATED', promotable: true, reason: 'Repeated independent evidence passed the promotion gate.' };
}
