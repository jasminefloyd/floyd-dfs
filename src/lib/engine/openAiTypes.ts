import type { ResearchArticle, ResearchBucket, ResearchFinding, ResearchPlan, ValidatedSlate } from './contracts.js';
export type { ResearchArticle, ResearchBucket, ResearchFinding, ResearchPlan, ValidatedSlate };
export interface ResearchSynthesizerInput { slate: ValidatedSlate; plan: ResearchPlan; articles: ResearchArticle[]; signal?: AbortSignal; }
