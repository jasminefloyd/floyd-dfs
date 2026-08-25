import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, respondError, tenantContext } from '../../server/runtime.js';
import { loadWeeklyReport, renderWeeklyLearningReport, sendWeeklyLearningReport } from '../../server/learningReport.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    const context = await tenantContext();
    const report = renderWeeklyLearningReport(await loadWeeklyReport(context.db, context.tenantId));
    if (String(req.query.preview ?? '') === '1') { cors(req, res); res.status(200).json({ subject: report.subject, html: report.html, text: report.text, sent: false }); return; }
    const apiKey = process.env.RESEND_API_KEY?.trim(); const to = process.env.WEEKLY_LEARNING_REPORT_EMAIL?.trim(); const from = process.env.WEEKLY_LEARNING_REPORT_FROM?.trim();
    if (!apiKey || !to || !from) throw new Error('Weekly report email requires RESEND_API_KEY, WEEKLY_LEARNING_REPORT_EMAIL, and WEEKLY_LEARNING_REPORT_FROM.');
    const sent = await sendWeeklyLearningReport(context.db, context.tenantId, { apiKey, to, from });
    cors(req, res); res.status(200).json({ subject: sent.subject, sent: true, resendId: sent.resendId, window: { since: sent.report.since, until: sent.report.until }, counts: { runs: sent.report.runs.length, measurements: sent.report.measurements.length, diagnostics: sent.report.diagnostics.length, lessons: sent.report.lessons.length } });
  } catch (error) { respondError(req, res, error); }
}
