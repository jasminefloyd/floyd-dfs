import type { ResearchArticle, ResearchBucket, ResearchFinding, ResearchPlan, ResearchSynthesizerInput, ValidatedSlate } from './openAiTypes.js';

type JsonFinding = { sourceIndex: number; bucket: ResearchBucket; subjectId: string; finding: string; confidence: 'LOW' | 'MEDIUM' | 'HIGH' };
export interface OpenAiResearchSynthesizerOptions { apiKey: string; model?: string; endpoint?: string; fetcher?: typeof fetch; }

export class OpenAiResearchSynthesizer {
  readonly name = 'OpenAI Research Synthesizer';
  private readonly fetcher: typeof fetch;
  private readonly options: OpenAiResearchSynthesizerOptions;
  constructor(options: OpenAiResearchSynthesizerOptions) { this.options = options; this.fetcher = options.fetcher ?? fetch; }
  async synthesize(input: ResearchSynthesizerInput): Promise<ResearchFinding[]> {
    if (!this.options.apiKey) throw new Error('OPENAI_API_KEY is required.');
    const response = await this.fetcher(this.options.endpoint ?? 'https://api.openai.com/v1/responses', { method: 'POST', signal: input.signal, headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: this.options.model ?? 'gpt-5', store: false, input: buildPrompt(input.slate, input.plan, input.articles), text: { format: { type: 'json_schema', name: 'research_findings', strict: true, schema: schema() } } }) });
    if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}.`);
    const payload = await response.json() as Record<string, unknown>;
    const text = typeof payload.output_text === 'string' ? payload.output_text : extractOutputText(payload.output);
    if (!text) throw new Error('OpenAI returned no structured research output.');
    const parsed = JSON.parse(text) as { findings?: JsonFinding[] };
    return (parsed.findings ?? []).flatMap((finding, index) => {
      const article = input.articles[finding.sourceIndex];
      const player = input.slate.playerPool.find((candidate) => candidate.playerId === finding.subjectId);
      if (!article || !finding.finding || !finding.bucket || !finding.subjectId) return [];
      return [{ id: `ai:${input.slate.slateId}:${finding.sourceIndex}:${index}`, bucket: finding.bucket, subjectType: player ? 'PLAYER' as const : 'EVENT' as const, subjectId: finding.subjectId, finding: finding.finding, sourceUrl: article.url, sourceName: article.sourceName, sourceTier: article.sourceTier, sourcePurpose: 'AI-structured claim grounded in retrieved source.', publishedAt: article.publishedAt, retrievedAt: new Date().toISOString(), confidence: finding.confidence, metadata: { model: this.options.model ?? 'gpt-5', sourceIndex: finding.sourceIndex } }];
    });
  }
}

function buildPrompt(slate: ValidatedSlate, plan: ResearchPlan, articles: ResearchArticle[]): string { return `You are a research evidence extractor for a DraftKings DFS slate. DraftKings defines the contest; do not invent contest data, projections, salaries, or lineups. Classify only claims supported by the supplied articles. Return at most one finding per article. Use the exact sourceIndex. Slate sport: ${slate.sport}. Players: ${slate.playerPool.map((player) => `${player.playerId}:${player.playerName}`).join(', ')}. Questions: ${plan.questions.map((question) => question.question).join(' | ')}. Articles: ${JSON.stringify(articles.map((article, sourceIndex) => ({ sourceIndex, title: article.title, sourceName: article.sourceName, url: article.url, summary: article.summary })))}`; }
function schema() { return { type: 'object', additionalProperties: false, properties: { findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { sourceIndex: { type: 'integer' }, bucket: { type: 'string', enum: ['AVAILABILITY', 'RECENT_ROLE_FORM', 'MATCHUP_ENVIRONMENT', 'MARKET_SIGNALS', 'NEWS_EXTERNAL_CONTEXT', 'FIELD_SENTIMENT', 'COMPETITIVE_CONTEXT'] }, subjectId: { type: 'string' }, finding: { type: 'string' }, confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] } }, required: ['sourceIndex', 'bucket', 'subjectId', 'finding', 'confidence'] } } }, required: ['findings'] }; }
function extractOutputText(output: unknown): string | undefined { if (!Array.isArray(output)) return undefined; const parts = output.flatMap((item) => item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []); return parts.map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string' ? (part as Record<string, unknown>).text : '').join('') || undefined; }
