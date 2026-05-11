// Fetch a user's feed from Bluesky (AT Protocol)
export async function fetchBlueskyFeed(handle: string) {
  try {
    // Step 1: Resolve the handle to a DID (Decentralized Identifier)
    const resolveRes = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
    if (!resolveRes.ok) {
        const errorText = await resolveRes.text();
        throw new Error(`Failed to resolve handle: ${resolveRes.status} ${resolveRes.statusText} - ${errorText}`);
    }
    const resolveData = await resolveRes.json();
    const did = resolveData.did;

    if (!did) {
      throw new Error("Could not resolve handle to DID");
    }

    // Step 2: Fetch the author's feed using the DID
    const feedRes = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}&limit=10`);
    if (!feedRes.ok) {
        const errorText = await feedRes.text();
        throw new Error(`Failed to fetch feed: ${feedRes.status} ${feedRes.statusText} - ${errorText}`);
    }
    const feedData = await feedRes.json();
    
    // Log the feed items
    console.log(`Fetched ${feedData.feed.length} posts for ${handle}:`);
    for (const item of feedData.feed) {
        const post = item.post.record;
        console.log(`- ${post.text || 'No text content'}`);
    }

    return feedData.feed;
  } catch (error) {
    console.error("Error fetching Bluesky feed:", error);
    return [];
  }
}

// Example usage
fetchBlueskyFeed('jay.bsky.team');
