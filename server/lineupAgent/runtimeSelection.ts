import type { CashLineCalibration } from '../../src/lib/engine/cashLineCalibration.js';
import type { OptimizerPackage, ResearchPackage, ValidatedSlate } from '../../src/lib/engine/contracts.js';
import { optimizePortfolio } from './portfolioOptimizer.js';
import { buildJointFieldScenarios } from './jointScenarioBuilder.js';

/** The only runtime bridge from the optimizer's certified field artifact to portfolio EV. */
export function selectRuntimePortfolio(input: {
  slate: ValidatedSlate;
  research: ResearchPackage;
  optimizer: OptimizerPackage;
  seed: string;
  cashLineCalibration?: CashLineCalibration;
  lockedRosterSlots?: Record<string, string>;
}) {
  const fieldScenarios = buildJointFieldScenarios(input.optimizer);
  const declaredReadiness = input.optimizer.contestSimulation?.readiness ?? 'UNAVAILABLE';
  const fieldReadiness = fieldScenarios.status === 'READY'
    ? 'CALIBRATED'
    : declaredReadiness === 'UNVALIDATED' ? 'UNVALIDATED' : 'UNAVAILABLE';
  return optimizePortfolio({
    slate: input.slate,
    research: input.research,
    optimizer: input.optimizer,
    seed: input.seed,
    fieldReadiness,
    ...(fieldScenarios.status === 'NOT_READY' ? { fieldReadinessReason: fieldScenarios.reasons.join(' ') } : {}),
    ...(input.cashLineCalibration ? { cashLineCalibration: input.cashLineCalibration } : {}),
    ...(input.lockedRosterSlots ? { lockedRosterSlots: input.lockedRosterSlots } : {}),
    ...(fieldScenarios.status === 'READY' ? { jointFieldScenarios: fieldScenarios.scenarios } : {}),
  });
}
