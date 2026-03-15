export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname !== '/163') {
      return new Response('Not Found', { status: 404 });
    }
    const listUrl = 'https://3g.163.com/touch/reconstruct/article/list/BBM54PGAwangning/0-10.html';
    const iPhoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    const pcUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    try {
      // 1. 获取列表
      const listRes = await fetch(listUrl, { headers: { 'User-Agent': iPhoneUA } });
      const rawText = await listRes.text();
      const jsonStr = rawText.substring(rawText.indexOf('(') + 1, rawText.lastIndexOf(')'));
      const newsList = JSON.parse(jsonStr)['BBM54PGAwangning'] || [];

      // 2. 只处理前 8 条
      const top8 = newsList.slice(0, 8);

      const items = await Promise.all(top8.map(async (article) => {
        const title = article.title;
        const docid = article.docid;
        if (!docid) return null;

        // 路径优先级：dy (网易号) 概率最高，其次是 news
        const paths = [
          `https://www.163.com/dy/article/${docid}.html`,
          `https://www.163.com/news/article/${docid}.html`
        ];

        let content = "";
        let finalLink = paths[0];

        // 核心抓取循环
        for (const path of paths) {
          try {
            const detailRes = await fetch(path, { 
              headers: { 
                'User-Agent': pcUA,
                'Referer': 'https://www.163.com/',
                'Cookie': '_ntes_nuid=' + Math.random().toString(36).substring(2), // 模拟随机 Cookie
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
              },
              redirect: 'follow' // 允许跟随，但我们要判断最终 URL
            });
            
            const html = await detailRes.text();
            
            // 判定：如果 HTML 包含 "post_body" 且字符数足够多，说明抓到了全文
            if (html.includes('post_body')) {
              const bodyMatch = html.match(/<div[^>]+class="post_body"[^>]*>([\s\S]*?)<\/div>/i);
              if (bodyMatch && bodyMatch[1].length > 400) {
                content = bodyMatch[1];
                finalLink = detailRes.url; // 使用最终跳转后的地址
                break;
              }
            }
          } catch (e) { continue; }
        }

        // --- 降级处理：如果 PC 端被拦截，尝试从移动端内联数据提取 ---
        if (!content || content.length < 200) {
          try {
            const mRes = await fetch(`https://3g.163.com/news/article/${docid}.html`, { 
              headers: { 'User-Agent': iPhoneUA } 
            });
            const mHtml = await mRes.text();
            // 网易移动端正文藏在 window.__DATA__ 的 body 字段里
            const dataMatch = mHtml.match(/"body"\s*:\s*"([\s\S]*?)"\s*,\s*"author"/);
            if (dataMatch) {
              content = dataMatch[1]
                .replace(/\\u([0-9a-fA-F]{4})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '<br/>');
              finalLink = `https://www.163.com/news/article/${docid}.html`;
            }
          } catch (e) {}
        }

        // 清洗与补全
        if (content) {
          content = content
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/\sdata-src=/gi, ' src=')
            .replace(/<div[^>]*>/gi, '<p>').replace(/<\/div>/gi, '</p>')
            .trim();
        } else {
          content = `<p>${article.digest || "点击原文查看详情"}</p>`;
        }

        return { title, link: finalLink, content };
      }));

      // 3. 构造 RSS
      let rss = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>';
      rss += '<title>网易新闻</title><link>https://news.163.com/</link>';
      for (const item of items) {
        if (!item) continue;
        rss += `<item>
          <title><![CDATA[${item.title}]]></title>
          <link>${item.link}</link>
          <guid>${item.link}</guid>
          <description><![CDATA[${item.content}]]></description>
          <pubDate>${new Date().toUTCString()}</pubDate>
        </item>`;
      }
      rss += '</channel></rss>';

      return new Response(rss, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });

    } catch (e) {
      return new Response("System Error: " + e.message, { status: 500 });
    }
  }
};
