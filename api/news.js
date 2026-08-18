const RSS_URL = 'https://news.google.com/rss/search?q=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5&hl=ko&gl=KR&ceid=KR:ko';
const STOP_WORDS = new Set([
  '인공지능', 'ai', 'a', 'i', '관련', '통해', '위해', '대한', '올해', '이번', '이달', '오늘', '내년',
  '한다', '한다는', '했다', '있는', '없는', '으로', '에서', '까지', '부터', '하다', '그', '더', '새',
  'news', '뉴스', '기자', '단독', '속보', '대한민국', '한국', '미국', '중국'
]);

function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function titleWithoutSource(title, source) {
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function normalized(title) {
  return title.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

function keywords(articles) {
  const counts = new Map();
  articles.forEach(({ title }) => {
    const words = title.toLowerCase().match(/[a-z]{2,}|[가-힣]{2,}/g) || [];
    new Set(words).forEach(word => {
      if (!STOP_WORDS.has(word) && !/^\d+$/.test(word)) counts.set(word, (counts.get(word) || 0) + 1);
    });
  });
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, 8).map(([term, count]) => ({ term: term.toUpperCase() === 'AI' ? 'AI' : term, count }));
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'GET 요청만 지원합니다.' });
  }

  try {
    const rssResponse = await fetch(RSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-News-Dashboard/1.0)' }
    });
    if (!rssResponse.ok) throw new Error(`Google 뉴스 응답: ${rssResponse.status}`);
    const xml = await rssResponse.text();
    const rawArticles = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
      const item = match[1];
      const source = tag(item, 'source');
      return {
        title: titleWithoutSource(tag(item, 'title'), source),
        link: tag(item, 'link'),
        source,
        publishedAt: new Date(tag(item, 'pubDate')).toISOString()
      };
    }).filter(article => article.title && article.link && !Number.isNaN(new Date(article.publishedAt).getTime()));

    const seen = new Set();
    const articles = rawArticles.filter(article => {
      const key = normalized(article.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    response.setHeader('Cache-Control', 'no-store, max-age=0');
    return response.status(200).json({
      collectedAt: new Date().toISOString(),
      rawCount: rawArticles.length,
      uniqueCount: articles.length,
      keywords: keywords(articles),
      articles: articles.slice(0, 20)
    });
  } catch (error) {
    return response.status(502).json({ error: '뉴스를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
