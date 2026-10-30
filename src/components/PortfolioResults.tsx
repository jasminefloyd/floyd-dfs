type RecordValue = Record<string, unknown>;

/** Present saved portfolio state without turning unavailable estimates into zeros. */
export function PortfolioResults({ data, error }: { data: RecordValue | null; error: string | null }) {
  if (error) return <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="text-sm font-black uppercase tracking-wide text-amber-950">Portfolio results</h2><p className="mt-2 text-xs text-amber-900">{error}</p></section>;
  if (!data) return null;
  const portfolio = asRecord(data.portfolio);
  if (!portfolio) return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Portfolio results</h2><p className="mt-2 text-sm text-slate-600">No saved portfolio is attached to this run.</p></section>;

  const members = asRecords(data.members);
  const lineups = new Map(asRecords(data.lineups).map((lineup) => [String(lineup.id ?? ''), lineup]));
  const entered = members.filter((member) => String(member.entry_status).toUpperCase() === 'ENTERED');
  const settled = entered.filter((member) => finite(member.actual_payout) !== null);
  const knownPayout = settled.reduce((sum, member) => sum + (finite(member.actual_payout) ?? 0), 0);
  const feesKnown = entered.every((member) => finite(member.entry_fee) !== null);
  const actualsComplete = entered.length > 0 && settled.length === entered.length;
  const entryFees = feesKnown ? entered.reduce((sum, member) => sum + (finite(member.entry_fee) ?? 0), 0) : null;
  const realizedNet = actualsComplete && entryFees !== null ? knownPayout - entryFees : null;
  const financialEstimatesReady = data.financialEstimates === 'CALIBRATED'
    && portfolio.payout_status === 'VERIFIED'
    && portfolio.field_model_status === 'CALIBRATED';

  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)]">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-black uppercase tracking-wide text-[#0b1f3a]">Portfolio results</h2><p className="mt-1 text-xs text-slate-500">{String(portfolio.objective ?? 'Objective unavailable').replaceAll('_', ' ')} · {members.length} selected lineup{members.length === 1 ? '' : 's'}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase text-slate-700">{String(data.payoutReadiness ?? portfolio.payout_status ?? 'UNAVAILABLE')}</span></div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Payout ladder" value={String(portfolio.payout_status ?? 'UNAVAILABLE')} />
      <Metric label="Opponent field" value={String(portfolio.field_model_status ?? 'UNAVAILABLE')} />
      <Metric label="Entered" value={`${entered.length} / ${members.length}`} />
      <Metric label="Realized net" value={realizedNet === null ? 'Unavailable' : amount(realizedNet)} />
    </div>
    {financialEstimatesReady ? <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-950"><p className="font-bold">Calibrated financial estimates</p><p className="mt-1">Estimated net payout: {amountOrUnavailable(portfolio.estimated_net_payout)} · Expected profit: {amountOrUnavailable(portfolio.expected_profit)} · Cash probability: {percentOrUnavailable(portfolio.cash_probability)}</p></div> : <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">Expected payout, profit, and cash probability are unavailable because the payout and calibrated field requirements are not both met.</p>}
    {entered.length ? <p className="mt-3 text-xs text-slate-600">Verified payout recorded for {settled.length} of {entered.length} entered lineups{!actualsComplete ? '. Net return remains unavailable until every entered lineup has a reconciled payout.' : '.'}</p> : <p className="mt-3 text-xs text-slate-600">Mark a lineup entered to track its contest fee and reconciled result.</p>}
    {members.length ? <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">{members.map((member, index) => {
      const lineupId = String(member.lineup_id ?? '');
      const lineup = lineups.get(lineupId);
      const payload = asRecord(lineup?.lineup_payload);
      const rank = payload?.bulletNumber ?? lineup?.bullet_number ?? index + 1;
      const actualPayout = finite(member.actual_payout);
      const estimatedPayout = financialEstimatesReady ? finite(member.estimated_payout) : null;
      return <li key={`${lineupId}:${String(member.lineup_revision ?? index)}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"><span className="font-bold text-[#0b1f3a]">Lineup #{String(rank)} · {String(member.entry_status ?? 'UNKNOWN')}</span><span className="text-right text-slate-600">{actualPayout !== null ? `Verified payout ${amount(actualPayout)}` : estimatedPayout !== null ? `Estimated payout ${amount(estimatedPayout)}` : 'Payout unavailable'}</span></li>;
    })}</ul> : null}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-[#0b1f3a]">{value}</p></div>;
}
function asRecord(value: unknown): RecordValue | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined; }
function asRecords(value: unknown): RecordValue[] { return Array.isArray(value) ? value.filter((item): item is RecordValue => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }
function finite(value: unknown): number | null { const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(number) ? number : null; }
function amount(value: number): string { return value.toFixed(2); }
function amountOrUnavailable(value: unknown): string { const number = finite(value); return number === null ? 'Unavailable' : amount(number); }
function percentOrUnavailable(value: unknown): string { const number = finite(value); return number === null ? 'Unavailable' : `${(number * 100).toFixed(1)}%`; }
