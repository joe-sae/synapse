import { FeedPost } from "../../drizzle/schema";

export async function fetchYoutubeFeed(limit = 20, pageToken?: string): Promise<{ posts: Partial<FeedPost>[], nextPageToken?: string }> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("[YouTube] YOUTUBE_API_KEY is not configured.");
    return { posts: [] };
  }

  try {
    // Fetch most popular videos (trending)
    let url = `https://www.googleapis.com/youtube/v3/videos?chart=mostPopular&regionCode=US&maxResults=${limit}&key=${apiKey}&part=snippet,contentDetails,statistics`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    
    const res = await fetch(url);
    
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch YouTube data: ${res.status} ${res.statusText} - ${errorText}`);
    }
    
    const data = (await res.json()) as any;
    const items = data.items || [];
    
    const posts = items.map((item: any) => ({
      platform: "youtube",
      externalId: item.id,
      author: item.snippet.channelTitle,
      authorId: item.snippet.channelId,
      content: item.snippet.description,
      title: item.snippet.title,
      engagementMetrics: JSON.stringify({
        views: parseInt(item.statistics.viewCount) || 0,
        likes: parseInt(item.statistics.likeCount) || 0,
        comments: parseInt(item.statistics.commentCount) || 0,
      }),
      platformMetadata: JSON.stringify({
        videoId: item.id,
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        duration: item.contentDetails.duration,
        definition: item.contentDetails.definition,
      }),
      createdAt: new Date(item.snippet.publishedAt),
    }));

    return { posts, nextPageToken: data.nextPageToken };
  } catch (error) {
    console.error("Error fetching YouTube feed:", error);
    return { posts: [] };
  }
}

export async function fetchYoutubeVideo(videoId: string): Promise<Partial<FeedPost> | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet,contentDetails,statistics`;
    const res = await fetch(url);
    const data = (await res.json()) as any;
    const item = data.items?.[0];
    if (!item) return null;

    return {
      platform: "youtube",
      externalId: videoId,
      author: item.snippet.channelTitle,
      authorId: item.snippet.channelId,
      content: item.snippet.description,
      title: item.snippet.title,
      engagementMetrics: JSON.stringify({
        views: parseInt(item.statistics.viewCount) || 0,
        likes: parseInt(item.statistics.likeCount) || 0,
      }),
      platformMetadata: JSON.stringify({
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        duration: item.contentDetails.duration,
      }),
      createdAt: new Date(item.snippet.publishedAt),
    };
  } catch (error) {
    return null;
  }
}
