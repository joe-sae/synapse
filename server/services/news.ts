import { FeedPost } from "../../drizzle/schema";

export async function fetchNewsFeed(query = "technology", page = 1, pageSize = 20): Promise<Partial<FeedPost>[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.warn("NewsAPI key is missing");
    return [];
  }

  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&apiKey=${apiKey}`;
    console.log(`[NewsAPI] Fetching: ${url}`);
    const response = await fetch(url);
    console.log(`[NewsAPI] Status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[NewsAPI] Error: ${errorText}`);
      throw new Error(`NewsAPI error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[NewsAPI] Fetched ${data.articles?.length || 0} articles`);
    if (data.status !== "ok") {
      throw new Error(`NewsAPI status not ok: ${data.message}`);
    }

    return data.articles.map((article: any, index: number) => ({
      platform: "news",
      externalId: article.url || `news-${Date.now()}-${index}`,
      author: article.author || article.source?.name || "News",
      authorId: article.source?.id || "news-source",
      content: article.description || article.content || "",
      title: article.title,
      engagementMetrics: JSON.stringify({
        source: article.source?.name,
      }),
      platformMetadata: JSON.stringify({
        url: article.url,
        urlToImage: article.urlToImage,
        publishedAt: article.publishedAt,
        source: article.source,
      }),
      createdAt: new Date(article.publishedAt || Date.now()),
    }));
  } catch (error) {
    console.error("Error fetching NewsAPI feed:", error);
    return [];
  }
}
