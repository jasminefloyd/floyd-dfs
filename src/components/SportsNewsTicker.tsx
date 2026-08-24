import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
import { listSportsNews, type SportsNewsItem } from '../lib/sportsNewsClient';

const SPORT_LABELS: Record<string, string> = {
  wnba: 'WNBA',
  nba: 'NBA',
  mlb: 'MLB',
  nfl: 'NFL',
  golf: 'GOLF',
};

const SPORT_LOGOS: Record<string, string> = {
  wnba: 'https://a.espncdn.com/i/teamlogos/leagues/500/wnba.png',
  nba: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png',
  mlb: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png',
  nfl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png',
  golf: 'https://a.espncdn.com/i/teamlogos/leagues/500/golf.png',
};
const ESPN_LOGO_URL = 'https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg';

export function SportsNewsTicker() {
  const [items, setItems] = useState<SportsNewsItem[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    listSportsNews(controller.signal)
      .then((news) => {
        setItems(news);
        setFailed(false);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.warn('Sports news ticker unavailable:', error);
        setFailed(true);
      });

    const interval = window.setInterval(() => {
      listSportsNews(controller.signal)
        .then((news) => {
          setItems(news);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }, 10 * 60 * 1000);

    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, []);

  const tickerItems = useMemo(() => {
    if (!items.length) return [];
    const repetitions = Math.max(2, Math.ceil(16 / items.length));
    return Array.from({ length: repetitions }, () => items).flat();
  }, [items]);
  const tickerStyle = {
    '--ticker-duration': `${Math.min(606, Math.max(404, tickerItems.length * 30.4))}s`,
  } as CSSProperties;

  if (failed && !items.length) return null;
  if (!items.length) {
    return (
      <div className="border-b border-white/10 bg-[#061426] px-4 py-2 text-xs text-blue-100">
        <div className="mx-auto max-w-7xl">Loading sports news...</div>
      </div>
    );
  }

  return (
    <div className="border-b border-white/10 bg-[#061426] text-blue-50">
      <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-hidden px-3 py-2 sm:px-6">
        <div className="shrink-0 rounded-sm bg-cyan-400 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-[#061426]">
          News
        </div>
        <div className="ticker-viewport relative min-w-0 flex-1 overflow-hidden">
          <div className="ticker-track flex w-max items-center" style={tickerStyle}>
            {[0, 1].map((groupIndex) => (
              <div
                key={groupIndex}
                className="ticker-group flex shrink-0 items-center gap-5"
                aria-hidden={groupIndex === 1}
              >
                {tickerItems.map((item, index) => {
                  const sportLabel = SPORT_LABELS[item.sport] ?? item.sport.toUpperCase();
                  const sportLogo = SPORT_LOGOS[item.sport];
                  return (
                    <a
                      key={`${groupIndex}-${item.id}-${index}`}
                      href={item.link ?? undefined}
                      target={item.link ? '_blank' : undefined}
                      rel={item.link ? 'noreferrer' : undefined}
                      className={`flex items-center gap-2 whitespace-nowrap text-[12px] leading-none transition-colors hover:text-white ${
                        item.category === 'injury' ? 'text-amber-300' : 'text-blue-100'
                      }`}
                    >
                      {item.source_kind === 'espn' ? (
                        <img src={ESPN_LOGO_URL} alt="ESPN" title="ESPN" className="h-5 w-8 shrink-0 object-contain" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                      ) : sportLogo ? (
                        <img
                          src={sportLogo}
                          alt={sportLabel}
                          title={sportLabel}
                          className="h-5 w-5 shrink-0 object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="rounded bg-slate-700 px-1 py-1 text-[9px] font-black text-white" title={item.source_name ?? 'Sports news'} aria-label={item.source_name ?? 'Sports news'}>{item.source_name ?? 'NEWS'}</span>
                      )}
                      {item.category === 'injury' ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      <span>{item.title}</span>
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
