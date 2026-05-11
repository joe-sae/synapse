import { FeedPost } from "../../drizzle/schema";

/**
 * Fetch a user's author feed from Bluesky. If the user has no posts,
 * fall back to a popular "Discover" feed so the tab always has content.
 */
export async function fetchBlueskyFeed(handle: string, limit = 20, cursor?: string): Promise<{ posts: Partial<FeedPost>[], cursor?: string }> {
  try {
    let cursorType = "author";
    let realCursor = cursor;

    if (cursor && cursor.startsWith("discover:")) {
      cursorType = "discover";
      realCursor = cursor.replace("discover:", "");
    } else if (cursor && cursor.startsWith("author:")) {
      cursorType = "author";
      realCursor = cursor.replace("author:", "");
    }

    // If we are already paginating the discover feed, just fetch that directly
    if (cursorType === "discover") {
      console.log(`[Bluesky] Fetching discover feed with cursor: ${realCursor}`);
      const res = await fetchBlueskyDiscoverFeed(limit, realCursor);
      return {
        posts: res.posts,
        cursor: res.cursor ? `discover:${res.cursor}` : undefined,
      };
    }

    // Step 1: Resolve the handle to a DID (Decentralized Identifier)
    const resolveRes = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
    console.log(`[Bluesky] Resolving handle: ${handle}, Status: ${resolveRes.status}`);
    if (!resolveRes.ok) {
        const errorText = await resolveRes.text();
        console.error(`[Bluesky] Resolution failed: ${errorText}`);
        throw new Error(`Failed to resolve handle: ${resolveRes.status} ${resolveRes.statusText} - ${errorText}`);
    }
    const resolveData = (await resolveRes.json()) as { did: string };
    const did = resolveData.did;
    console.log(`[Bluesky] Resolved DID: ${did}`);

    if (!did) {
      throw new Error("Could not resolve handle to DID");
    }

    // Step 2: Try the author's feed first
    let url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}&limit=${limit}`;
    if (realCursor) {
      url += `&cursor=${encodeURIComponent(realCursor)}`;
    }

    const feedRes = await fetch(url);
    console.log(`[Bluesky] Fetching author feed: Status: ${feedRes.status}`);
    if (!feedRes.ok) {
        const errorText = await feedRes.text();
        console.error(`[Bluesky] Author feed fetch failed: ${errorText}`);
        // Don't throw - fall through to discover feed
    } else {
      const feedData = (await feedRes.json()) as { feed: any[], cursor?: string };
      console.log(`[Bluesky] Author feed returned ${feedData.feed.length} posts`);

      if (feedData.feed.length > 0) {
        const posts = mapBlueskyPosts(feedData.feed);
        return { 
          posts, 
          // Prefix the returned cursor with "author:"
          cursor: feedData.cursor ? `author:${feedData.cursor}` : undefined 
        };
      }
    }

    // Step 3: Author has no posts (or reached end of author feed) — fetch the Discover feed starting from the beginning
    console.log(`[Bluesky] Author feed empty, fetching Discover feed from beginning`);
    const discoverRes = await fetchBlueskyDiscoverFeed(limit, undefined);
    return {
      posts: discoverRes.posts,
      cursor: discoverRes.cursor ? `discover:${discoverRes.cursor}` : undefined,
    };

  } catch (error) {
    console.error("Error fetching Bluesky feed:", error);
    // Last resort: try discover feed from beginning
    try {
      const discoverRes = await fetchBlueskyDiscoverFeed(limit, undefined);
      return {
        posts: discoverRes.posts,
        cursor: discoverRes.cursor ? `discover:${discoverRes.cursor}` : undefined,
      };
    } catch {
      return { posts: [] };
    }
  }
}

/**
 * Fetch the Bluesky Discover feed using a public custom feed.
 */
async function fetchBlueskyDiscoverFeed(limit = 20, cursor?: string): Promise<{ posts: Partial<FeedPost>[], cursor?: string }> {
  try {
    const feedUri = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/discover';
    let url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=${limit}`;
    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const res = await fetch(url);
    console.log(`[Bluesky] Discover feed status: ${res.status}`);
    
    if (!res.ok) {
      const err = await res.text();
      console.error(`[Bluesky] Discover feed failed: ${err}`);
      return { posts: [] };
    }

    const data = (await res.json()) as { feed: any[], cursor?: string };
    console.log(`[Bluesky] Discover returned ${data.feed.length} posts`);
    const posts = mapBlueskyPosts(data.feed);
    return { posts, cursor: data.cursor };
  } catch (error) {
    console.error("[Bluesky] Discover feed error:", error);
    return { posts: [] };
  }
}

/**
 * Map posts from app.bsky.feed.getAuthorFeed format
 */
function mapBlueskyPosts(feed: any[]): Partial<FeedPost>[] {
  return feed.map((item: any) => {
    const post = item.post;
    const record = post.record;
    
    return {
      platform: "bluesky",
      externalId: post.cid,
      author: post.author.handle,
      authorId: post.author.did,
      content: record.text || "",
      engagementMetrics: JSON.stringify({
        likes: post.likeCount || 0,
        reposts: post.repostCount || 0,
        replies: post.replyCount || 0,
      }),
      platformMetadata: JSON.stringify({
        did: post.author.did,
        avatar: post.author.avatar,
        uri: post.uri,
      }),
      createdAt: new Date(record.createdAt),
    };
  });
}

/**
 * Map posts from app.bsky.feed.searchPosts format (slightly different structure)
 */
function mapBlueskySearchPosts(posts: any[]): Partial<FeedPost>[] {
  return posts.map((post: any) => {
    const record = post.record;
    
    return {
      platform: "bluesky",
      externalId: post.cid,
      author: post.author?.handle || "unknown",
      authorId: post.author?.did || "unknown",
      content: record?.text || "",
      engagementMetrics: JSON.stringify({
        likes: post.likeCount || 0,
        reposts: post.repostCount || 0,
        replies: post.replyCount || 0,
      }),
      platformMetadata: JSON.stringify({
        did: post.author?.did,
        avatar: post.author?.avatar,
        uri: post.uri,
      }),
      createdAt: new Date(record?.createdAt || Date.now()),
    };
  });
}
