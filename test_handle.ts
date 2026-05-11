import { fetchBlueskyFeed } from "./bluesky_fetch_snippet.ts";

fetchBlueskyFeed('joesae05.bsky.social').then(posts => {
    console.log("RESULT:", posts.length, "posts found");
}).catch(console.error);
