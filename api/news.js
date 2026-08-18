const RSS_URL = 'https://news.google.com/rss/search?q=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&hl=ko&gl=KR&ceid=KR:ko';

const STOP_WORDS = new Set([
  '인공지능', 'ai', 'a', 'i', '관련', '통해', '위한', '대한', '위해', '위해', '이용', '활용', '기반',
  '한다', '했다', '한다는', '있는', '있는가', '된다', '됐다', '한다며', '이번', '이것', '그것', '더',
  '및', '등', '새', '첫', '왜', '뒤', '앞', '속', '외', '수', '년', '월', '일', '기자', '뉴스'
]);

function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decode(match[1]).trim() : '';
}

function titleWithoutSource(title, source) {
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function tokens(title) {
  return (title.match(/[A-Za-z]{2,}|[가-힣]{2,}/g) || [])
    .map(word => /^[A-Za-z]+$/.test(word) ? word.toUpperCase() : word)
    .filter(word => !STOP_WORDS.has(word.toLowerCase()));
}

function similarity(one, two) {
  const a = new Set(tokens(one)); const b = new Set(tokens(two));
  const shared = [...a].filter(word => b.has(word)).length;
  return shared / Math.max(1, a.size + b.size - shared);
}

function uniqueArticles(articles) {
  return articles.filter((article, index) => !articles.slice(0, index)
    .some(existing => similarity(existing.title, article.title) >= 0.72));
}

function keywordRanking(articles) {
  const counts = new Map();
  for (const article of articles) {
    for (const word of new Set(tokens(article.title))) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts]
    .filter(([term]) => term.length >= 2 && !STOP_WORDS.has(term.toLowerCase()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, 8).map(([term, count]) => ({ term, count }));
}

module.exports = async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  try {
    const upstream = await fetch(RSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-News-Dashboard/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!upstream.ok) throw new Error(`Google 뉴스 응답 오류 (${upstream.status})`);
    const xml = await upstream.text();
    const rawArticles = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
      const item = match[1];
      const source = tag(item, 'source');
      return { title: titleWithoutSource(tag(item, 'title'), source), link: tag(item, 'link'), source, publishedAt: tag(item, 'pubDate') };
    }).filter(article => article.title && article.link);
    const articles = uniqueArticles(rawArticles);
    response.status(200).json({
      collectedAt: new Date().toISOString(), rawCount: rawArticles.length, uniqueCount: articles.length,
      keywords: keywordRanking(articles), articles: articles.slice(0, 20)
    });
  } catch (error) {
    response.status(502).json({ error: 'Google 뉴스 수집에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
};
