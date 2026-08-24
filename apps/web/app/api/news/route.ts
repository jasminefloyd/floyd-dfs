import { DEFAULT_RSS_FEEDS, parseRss } from "@sports-engine/research";

export const revalidate = 600;

export async function GET() {
  const results = await Promise.allSettled(DEFAULT_RSS_FEEDS.map(async (feed) => {
    const response = await fetch(feed.url, { headers: { accept: "application/rss+xml, application/xml, text/xml" }, next: { revalidate: 600 } });
    if (!response.ok) throw new Error(`${feed.name} returned HTTP ${response.status}.`);
    return parseRss(await response.text(), feed);
  }));
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []).map((article, index) => {
    const sport = inferSport(article);
    const sourceName = article.sourceName;
    const sourceKind = sport === "sports" ? "espn" : "league";
    return { id: `${sport}:${article.url ?? article.title}:${index}`, sport, title: article.title, link: article.url ?? null, published_at: article.publishedAt ?? null, category: categorize(article.title), source_name: sourceName, source_kind: sourceKind };
  }).filter((item) => item.title).sort((a, b) => Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? "")).slice(0, 40);
  return Response.json({ items, generated_at: new Date().toISOString() }, { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=1200" } });
}

function inferSport(article: { sourceName: string; title: string; summary?: string; tags?: string[] }) {
  const taggedSport = article.tags?.find((tag) => ["NBA", "WNBA", "NFL", "MLB", "GOLF"].includes(tag.toUpperCase()));
  if (taggedSport) return taggedSport.toLowerCase();
  const text = `${article.title} ${article.summary ?? ""} ${article.sourceName}`;
  const matches = ["WNBA", "NBA", "NFL", "MLB", "GOLF"].filter((sport) => new RegExp(`\\b${sport}\\b`, "i").test(text));
  return matches.length === 1 ? matches[0].toLowerCase() : "sports";
}
function categorize(title: string): "injury" | "trade" | "transaction" | "news" { if (/injur|out|questionable|doubtful|inactive|ruled out/i.test(title)) return "injury"; if (/trade/i.test(title)) return "trade"; if (/sign|waive|released|acquire|transaction/i.test(title)) return "transaction"; return "news"; }
