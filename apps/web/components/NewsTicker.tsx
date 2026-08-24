"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type NewsItem = { id: string; sport: string; title: string; link: string | null; category: "injury" | "trade" | "transaction" | "news"; source_name?: string; source_kind?: "espn" | "league" | "unknown" };
const labels: Record<string, string> = { nba: "NBA", wnba: "WNBA", nfl: "NFL", mlb: "MLB", golf: "GOLF" };
const ESPN_LOGO_URL = "https://upload.wikimedia.org/wikipedia/commons/2/2f/ESPN_wordmark.svg";
const logos: Record<string, string> = { nba: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png", wnba: "https://a.espncdn.com/i/teamlogos/leagues/500/wnba.png", nfl: "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png", mlb: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png", golf: "https://a.espncdn.com/i/teamlogos/leagues/500/golf.png" };

export function NewsTicker() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; const load = () => fetch("/api/news").then((response) => { if (!response.ok) throw new Error("News request failed."); return response.json() as Promise<{ items?: NewsItem[] }>; }).then((data) => { if (active) { setItems(data.items ?? []); setFailed(false); } }).catch(() => { if (active) setFailed(true); }); load(); const timer = window.setInterval(load, 10 * 60 * 1000); return () => { active = false; window.clearInterval(timer); }; }, []);
  const tickerItems = useMemo(() => items.length ? Array.from({ length: Math.max(2, Math.ceil(16 / items.length)) }, () => items).flat() : [], [items]);
  const style = { "--news-ticker-duration": `${Math.min(606, Math.max(404, tickerItems.length * 30.4))}s` } as CSSProperties;
  if (failed && !items.length) return null;
  if (!items.length) return <div className="news-ticker"><div className="news-ticker-inner"><span className="news-ticker-label">News</span><span className="news-ticker-loading">Loading sports news…</span></div></div>;
  return <div className="news-ticker"><div className="news-ticker-inner"><span className="news-ticker-label">News</span><div className="news-ticker-viewport"><div className="news-ticker-track" style={style}>{[0, 1].map((group) => <div className="news-ticker-group" key={group} aria-hidden={group === 1}>{tickerItems.map((item, index) => <a className={item.category === "injury" ? "news-ticker-item injury" : "news-ticker-item"} href={item.link ?? undefined} target={item.link ? "_blank" : undefined} rel={item.link ? "noreferrer" : undefined} key={`${group}-${item.id}-${index}`}>{item.source_kind === "espn" ? <img src={ESPN_LOGO_URL} alt="ESPN" title="ESPN" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : logos[item.sport] ? <img src={logos[item.sport]} alt={labels[item.sport] ?? item.sport.toUpperCase()} title={labels[item.sport] ?? item.sport.toUpperCase()} onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <span className="league-badge" title={item.source_name ?? "Sports news"} aria-label={item.source_name ?? "Sports news"}>{item.source_name ?? "NEWS"}</span>}{item.category === "injury" && <b aria-label="injury">⚠</b>}<span>{item.title}</span></a>)}</div>)}</div></div></div></div>;
}
