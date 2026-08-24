export function formatNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'; }
export function formatMoney(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? `$${Math.round(value / 1000)}k` : '—'; }
export function formatDate(value: string) { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'; }
