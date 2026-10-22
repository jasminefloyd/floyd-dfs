import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, respondError, schedulerContext } from '../../server/runtime.js';
import { loadWeeklyReport, renderWeeklyLearningReport, sendWeeklyLearningReport } from '../../server/learningReport.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  let runId: string | undefined;
  let context: Awaited<ReturnType<typeof schedulerContext>> | undefined;
  try {
    context = await schedulerContext(req);
    const report = renderWeeklyLearningReport(await loadWeeklyReport(context.db, context.tenantId));
    if (String(req.query.preview ?? '') === '1') { cors(req, res); res.status(200).json({ subject: report.subject, html: report.html, text: report.text, sent: false }); return; }
    const week = new Date(); week.setUTCHours(0, 0, 0, 0); week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
    const jobKey = `weekly-learning-report:${week.toISOString().slice(0, 10)}`;
    const claim = await context.db.from('floyd_dfs_scheduler_runs').insert({ tenant_id: context.tenantId, job_key: jobKey, job_type: 'WEEKLY_LEARNING_REPORT', status: 'RUNNING' }).select('id').single();
    if (claim.error?.code === '23505') { cors(req, res); res.status(409).json({ error: 'The weekly learning report has already been claimed for this week.', code: 'DUPLICATE_JOB' }); return; }
    if (claim.error) throw claim.error;
    runId = String(claim.data.id);
    const apiKey = process.env.RESEND_API_KEY?.trim(); const to = process.env.WEEKLY_LEARNING_REPORT_EMAIL?.trim(); const from = process.env.WEEKLY_LEARNING_REPORT_FROM?.trim();
    if (!apiKey || !to || !from) throw new Error('Weekly report email requires RESEND_API_KEY, WEEKLY_LEARNING_REPORT_EMAIL, and WEEKLY_LEARNING_REPORT_FROM.');
    const sent = await sendWeeklyLearningReport(context.db, context.tenantId, { apiKey, to, from });
    await context.db.from('floyd_dfs_scheduler_runs').update({ status: 'SUCCEEDED', completed_at: new Date().toISOString(), result: { resendId: sent.resendId ?? null } }).eq('id', runId).eq('tenant_id', context.tenantId);
    cors(req, res); res.status(200).json({ subject: sent.subject, sent: true, resendId: sent.resendId, window: { since: sent.report.since, until: sent.report.until }, counts: { runs: sent.report.runs.length, measurements: sent.report.measurements.length, diagnostics: sent.report.diagnostics.length, lessons: sent.report.lessons.length } });
  } catch (error) { if (runId && context) await context.db.from('floyd_dfs_scheduler_runs').update({ status: 'FAILED', completed_at: new Date().toISOString(), error: { message: error instanceof Error ? error.message : 'Scheduled report failed.' } }).eq('id', runId).eq('tenant_id', context.tenantId); respondError(req, res, error); }
}
