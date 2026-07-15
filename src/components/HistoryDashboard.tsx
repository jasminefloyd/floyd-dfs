interface HistoryItem {
  id: string;
  sport: string;
  contestDate: string;
  topProjection: number;
  lineupCount: number;
  createdAt: string;
}

interface HistoryDashboardProps {
  items: HistoryItem[];
}

export function HistoryDashboard({ items }: HistoryDashboardProps) {
  if (!items.length) return null;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-bold text-gray-900">Recent Scans</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-gray-500">
            <tr>
              <th className="py-2 pr-3">Sport</th>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Lineups</th>
              <th className="py-2 pr-3">Top Projection</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 5).map((item) => (
              <tr key={item.id} className="border-t border-gray-100">
                <td className="py-2 pr-3 uppercase">{item.sport}</td>
                <td className="py-2 pr-3">{item.contestDate}</td>
                <td className="py-2 pr-3">{item.lineupCount}</td>
                <td className="py-2 pr-3">{item.topProjection.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export type { HistoryItem };
