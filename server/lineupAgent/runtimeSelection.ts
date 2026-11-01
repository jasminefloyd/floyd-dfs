import type { CashLineCalibration } from '../../src/lib/engine/cashLineCalibration.js';
import type { OptimizerPackage, ResearchPackage, ValidatedSlate } from '../../src/lib/engine/contracts.js';
import { optimizePortfolio } from './portfolioOptimizer.js';

/** The only runtime bridge from the optimizer's certified field artifact to portfolio EV. */
export function selectRuntimePortfolio(input: {
  slate: ValidatedSlate;
  research: ResearchPackage;
  optimizer: OptimizerPackage;
  seed: string;
  cashLineCalibration?: CashLineCalibration;
  lockedRosterSlots?: Record<string, string>;
}) {
  const fieldReadiness = input.optimizer.contestSimulation?.readiness ?? 'UNAVAILABLE';
  const jointFieldScenarios = fieldReadiness === 'CALIBRATED' ? input.optimizer.contestSimulation?.jointFieldScenarios : undefined;
  return optimizePortfolio({
    slate: input.slate,
    research: input.research,
    optimizer: input.optimizer,
    seed: input.seed,
    fieldReadiness,
    ...(input.cashLineCalibration ? { cashLineCalibration: input.cashLineCalibration } : {}),
    ...(input.lockedRosterSlots ? { lockedRosterSlots: input.lockedRosterSlots } : {}),
    ...(jointFieldScenarios ? { jointFieldScenarios } : {}),
  });
}
