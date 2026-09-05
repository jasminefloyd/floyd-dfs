import type { ResearchArticle, ResearchBucket, ResearchFinding, ResearchPlan, ResearchSynthesizerInput, ValidatedSlate } from './openAiTypes.js';
import { providerHttpError } from './providerDiagnostics.js';
import type { ProviderHttpDiagnostics } from './providerDiagnostics.js';

type JsonFinding = { sourceIndex: number; bucket: ResearchBucket; subjectId: string; finding: string; confidence: 'LOW' | 'MEDIUM' | 'HIGH' };
export interface AnthropicResearchSynthesizerOptions { apiKey: string; model?: string; endpoint?: string; fetcher?: typeof fetch; }

export class AnthropicResearchSynthesizer {
  readonly name = 'Anthropic Research Synthesizer';
  private readonly fetcher: typeof fetch;
  private readonly options: AnthropicResearchSynthesizerOptions;
  constructor(options: AnthropicResearchSynthesizerOptions) { this.options = options; this.fetcher = options.fetcher ?? fetch; }

  async synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> {
    const response = await this.fetcher(this.options.endpoint ?? 'https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: input.signal,
      headers: { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.options.model ?? 'claude-sonnet-4-5-20250929', max_tokens: 4096, system: 'Return only valid JSON. Never invent facts, players, sources, or findings. Use only the supplied articles.', messages: [{ role: 'user', content: buildPrompt(input.slate, input.plan, input.articles) }] }),
    });
    if (!response.ok) throw await providerHttpError('Anthropic Messages API', response);
    const payload = await response.json() as Record<string, unknown>;
    const text = extractText(payload.content);
    if (!text) throw new Error('Anthropic returned no structured research output.');
    const parsed = JSON.parse(stripCodeFence(text)) as { findings?: JsonFinding[] };
    return (parsed.findings ?? []).flatMap((finding, index) => {
      const article = input.articles[finding.sourceIndex];
      const player = input.slate.playerPool.find((candidate) => candidate.playerId === finding.subjectId);
      if (!article || !finding.finding || !finding.bucket || !finding.subjectId) return [];
      return [{ id: `anthropic:${input.slate.slateId}:${finding.sourceIndex}:${index}`, bucket: finding.bucket, subjectType: player ? 'PLAYER' as const : 'EVENT' as const, subjectId: finding.subjectId, finding: finding.finding, sourceUrl: article.url, sourceName: article.sourceName, sourceTier: article.sourceTier, sourcePurpose: 'Anthropic-structured claim grounded in retrieved source.', publishedAt: article.publishedAt, retrievedAt: new Date().toISOString(), confidence: finding.confidence, metadata: { model: this.options.model ?? 'claude-sonnet-4-5-20250929', sourceIndex: finding.sourceIndex } }];
    });
  }
}

export class FallbackResearchSynthesizer {
  private readonly primary?: { synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> };
  private readonly fallback: { synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> };
  lastDiagnostics: Array<{ provider: string; status: 'SUCCEEDED' | 'FAILED'; error?: string; diagnostics?: ProviderHttpDiagnostics }> = [];
  constructor(input: { primary?: { synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> }; fallback: { synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> } }) { this.primary = input.primary; this.fallback = input.fallback; }
  async synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> {
    this.lastDiagnostics = [];
    if (!this.primary) {
      try { const result = await this.fallback.synthesize(input); this.lastDiagnostics.push({ provider: 'Anthropic Research Synthesis', status: 'SUCCEEDED' }); return result; }
      catch (error) { const reason = error instanceof Error ? error.message : 'Anthropic research synthesizer failed.'; this.lastDiagnostics.push({ provider: 'Anthropic Research Synthesis', status: 'FAILED', error: reason }); throw error; }
    }
    try { const result = await this.primary.synthesize(input); this.lastDiagnostics.push({ provider: 'OpenAI Research Synthesis', status: 'SUCCEEDED' }); return result; }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Primary research synthesizer failed.';
      this.lastDiagnostics.push({ provider: 'OpenAI Research Synthesis', status: 'FAILED', error: reason });
      try { const result = await this.fallback.synthesize(input); this.lastDiagnostics.push({ provider: 'Anthropic Research Synthesis', status: 'SUCCEEDED' }); return result; }
      catch (fallbackError) { const fallbackReason = fallbackError instanceof Error ? fallbackError.message : 'Fallback research synthesizer failed.'; this.lastDiagnostics.push({ provider: 'Anthropic Research Synthesis', status: 'FAILED', error: fallbackReason }); throw new Error(`OpenAI research synthesis failed (${reason}); Anthropic fallback failed (${fallbackReason}).`); }
    }
  }
}

function buildPrompt(slate: ValidatedSlate, plan: ResearchPlan, articles: ResearchArticle[]): string {
  return `You are a research evidence extractor for a DraftKings DFS slate. DraftKings defines the contest; do not invent contest data, projections, salaries, or lineups. Classify only claims supported by the supplied articles. Return at most one finding per article. Use the exact sourceIndex. Return JSON matching {"findings":[{"sourceIndex":0,"bucket":"AVAILABILITY|RECENT_ROLE_FORM|MATCHUP_ENVIRONMENT|MARKET_SIGNALS|NEWS_EXTERNAL_CONTEXT|FIELD_SENTIMENT|COMPETITIVE_CONTEXT","subjectId":"player or event id","finding":"supported claim","confidence":"LOW|MEDIUM|HIGH"}]}. Slate sport: ${slate.sport}. Players: ${slate.playerPool.map((player) => `${player.playerId}:${player.playerName}`).join(', ')}. Questions: ${plan.questions.map((question) => question.question).join(' | ')}. Articles: ${JSON.stringify(articles.map((article, sourceIndex) => ({ sourceIndex, title: article.title, sourceName: article.sourceName, url: article.url, summary: article.summary })))}`;
}
function extractText(content: unknown): string | undefined { if (!Array.isArray(content)) return undefined; return content.map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string' ? (part as Record<string, unknown>).text : '').join('').trim() || undefined; }
function stripCodeFence(value: string): string { return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); }
