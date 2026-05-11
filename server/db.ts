import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, feedPosts, FeedPost, userPreferences, UserPreference, InsertUserPreference } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

import { fetchBlueskyFeed } from "./services/bluesky";
import { fetchGithubFeed } from "./services/github";
import { fetchYoutubeFeed, fetchYoutubeVideo } from "./services/youtube";
import { fetchNewsFeed } from "./services/news";

/**
 * Get feed posts with optional filtering
 */
export async function getFeedPosts(options?: {
  platform?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}): Promise<{ items: FeedPost[], nextCursor?: string }> {
  const limit = options?.limit || 20;
  const offset = options?.offset || 0;

  // If platform is bluesky, we try to fetch live data
  if (options?.platform === "bluesky") {
    const handle = ENV.blueskyHandle || 'jay.bsky.team';
    let bskyCursor = options?.cursor;
    if (bskyCursor === "0") bskyCursor = undefined;
    
    console.log(`[Database] Attempting to fetch live Bluesky feed for handle: ${handle}, cursor: ${bskyCursor}`);
    const { posts: livePosts, cursor: nextCursor } = await fetchBlueskyFeed(handle, limit, bskyCursor);
    console.log(`[Database] Fetched ${livePosts.length} live Bluesky posts`);
    
    return {
      items: livePosts.map((p) => ({
        id: Math.floor(Math.random() * 1000000000),
        updatedAt: new Date(),
        createdAt: p.createdAt || new Date(),
        ...p
      } as FeedPost)),
      nextCursor: nextCursor || "0"
    };
  }

  // If platform is news, we try to fetch live data
  if (options?.platform === "news") {
    // cursor for news is page number as a string e.g. "1", "2"
    let page = options?.cursor ? parseInt(options.cursor, 10) || 1 : 1;
    if (page < 1) page = 1;

    console.log(`[Database] Attempting to fetch live News feed, page: ${page}`);
    const livePosts = await fetchNewsFeed("technology", page, limit);
    console.log(`[Database] Fetched ${livePosts.length} live News posts`);
    return {
      items: livePosts.map((p) => ({
        id: Math.floor(Math.random() * 1000000000),
        updatedAt: new Date(),
        createdAt: p.createdAt || new Date(),
        ...p
      } as FeedPost)),
      // Loop back to page 1 if we didn't get a full page
      nextCursor: livePosts.length >= limit ? String(page + 1) : "1"
    };
  }

  // If platform is github, we try to fetch live data
  if (options?.platform === "github") {
    const livePosts = await fetchGithubFeed('octocat');
    if (livePosts.length > 0) {
      return {
        items: livePosts.map((p, index) => ({
          id: index + 2000 + offset,
          updatedAt: new Date(),
          createdAt: p.createdAt || new Date(),
          ...p
        } as FeedPost)),
        nextCursor: "0" // Loop back to start
      };
    }
  }

  // If platform is youtube, we try to fetch live feed
  if (options?.platform === "youtube") {
    let pageToken = options?.cursor;
    if (pageToken === "0") pageToken = undefined;

    const { posts: livePosts, nextPageToken } = await fetchYoutubeFeed(limit, pageToken);
    
    return {
      items: livePosts.map((p) => ({
        id: Math.floor(Math.random() * 1000000000),
        updatedAt: new Date(),
        createdAt: p.createdAt || new Date(),
        ...p
      } as FeedPost)),
      nextCursor: nextPageToken || "0" // Loop back to start
    };
  }

  // For "all" feed: fetch live data and merge
  if (!options?.platform || options.platform === 'all') {
    const limitPerSource = Math.ceil(limit / 3);
    
    let ytCursor: string | undefined;
    let bskyCursor: string | undefined;
    let newsPage = 1;

    if (options?.cursor) {
      try {
        const state = JSON.parse(options.cursor);
        ytCursor = state.yt;
        bskyCursor = state.bsky;
        newsPage = state.news || 1;
      } catch (e) {
        // Fallback if not valid JSON
        newsPage = 1;
      }
    }
    
    // Fetch live data for each source in parallel
    const [ytResult, bskyResult, newsArticles] = await Promise.allSettled([
      fetchYoutubeFeed(limitPerSource, ytCursor),
      fetchBlueskyFeed(ENV.blueskyHandle || 'jay.bsky.team', limitPerSource, bskyCursor),
      fetchNewsFeed("technology", newsPage, limitPerSource),
    ]);

    const liveYoutubePosts = ytResult.status === 'fulfilled' ? ytResult.value.posts : [];
    const ytNext = ytResult.status === 'fulfilled' ? ytResult.value.nextPageToken : undefined;

    const liveBlueskyPosts = bskyResult.status === 'fulfilled' ? bskyResult.value.posts : [];
    const bskyNext = bskyResult.status === 'fulfilled' ? bskyResult.value.cursor : undefined;

    const liveNewsPosts    = newsArticles.status === 'fulfilled' ? newsArticles.value : [];
    const newsNextPage = liveNewsPosts.length >= limitPerSource ? newsPage + 1 : 1;

    const allLive = [
      ...liveYoutubePosts.map((p) => ({ id: Math.floor(Math.random() * 1000000000), updatedAt: new Date(), createdAt: p.createdAt || new Date(), ...p } as FeedPost)),
      ...liveBlueskyPosts.map((p) => ({ id: Math.floor(Math.random() * 1000000000), updatedAt: new Date(), createdAt: p.createdAt || new Date(), ...p } as FeedPost)),
      ...liveNewsPosts.map((p) => ({ id: Math.floor(Math.random() * 1000000000), updatedAt: new Date(), createdAt: p.createdAt || new Date(), ...p } as FeedPost)),
    ];

    if (allLive.length > 0) {
        return {
            items: allLive.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
            nextCursor: JSON.stringify({ yt: ytNext || "0", bsky: bskyNext || "0", news: newsNextPage })
        };
    } else {
        // If everything ran dry, restart offset so client wraps around
        return {
            items: [],
            nextCursor: JSON.stringify({ yt: "0", bsky: "0", news: 1 })
        };
    }
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get feed posts: database not available. Returning mock data instead.");
    // Fallback mock data if DB is not available
        const mockFeedPosts: FeedPost[] = [
      {
        id: 1,
        platform: "twitter",
        externalId: "tw_1001",
        author: "@cyber_punk",
        authorId: "user_cyber",
        content: "Just configured my neovim with Lua. It's blazing fast. #cyberpunk #coding",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":420,\"retweets\":69,\"replies\":12}",
        platformMetadata: "{\"verified\":true}",
        createdAt: new Date(Date.now() - 1000 * 60 * 393),
        updatedAt: new Date(),
      },
      {
        id: 2,
        platform: "twitter",
        externalId: "tw_1002",
        author: "@neon_dreams",
        authorId: "user_neon",
        content: "The aesthetic of Blade Runner never gets old. We need more neon in UI design. Minimalist and dark.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":1337,\"retweets\":256,\"replies\":42}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 391),
        updatedAt: new Date(),
      },
      {
        id: 3,
        platform: "twitter",
        externalId: "tw_1003",
        author: "@frontend_dev",
        authorId: "user_fe",
        content: "Tailwind v4 is out and it's incredible. The new engine is so much faster. #webdev",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":892,\"retweets\":120,\"replies\":34}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 291),
        updatedAt: new Date(),
      },
      {
        id: 4,
        platform: "twitter",
        externalId: "tw_1004",
        author: "@sys_admin",
        authorId: "user_sys",
        content: "Server migrations at 3 AM hit different. Coffee and logs. #devops",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":156,\"retweets\":24,\"replies\":8}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 148),
        updatedAt: new Date(),
      },
      {
        id: 5,
        platform: "facebook",
        externalId: "fb_1",
        author: "Tech Enthusiasts Group",
        authorId: "fb_u1",
        content: "Check out this new framework for building desktop apps with React! Has anyone tried it yet?",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":340,\"comments\":85,\"shares\":20}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 782),
        updatedAt: new Date(),
      },
      {
        id: 6,
        platform: "facebook",
        externalId: "fb_2",
        author: "Cyber Security News",
        authorId: "fb_u2",
        content: "A major vulnerability has been found in older routers. Make sure to patch your devices ASAP to prevent unauthorized access.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":890,\"comments\":230,\"shares\":450}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 1326),
        updatedAt: new Date(),
      },
      {
        id: 7,
        platform: "facebook",
        externalId: "fb_3",
        author: "Jane Doe",
        authorId: "fb_u3",
        content: "Finally finished my setup! Dual 4K monitors and a mechanical keyboard. So happy right now.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":120,\"comments\":15}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 589),
        updatedAt: new Date(),
      },
      {
        id: 8,
        platform: "facebook",
        externalId: "fb_4",
        author: "Web Dev Bootcamps",
        authorId: "fb_u4",
        content: "New cohort starting next week! Learn full-stack development in 12 weeks. Apply now.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":56,\"comments\":12,\"shares\":5}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 811),
        updatedAt: new Date(),
      },
      {
        id: 9,
        platform: "instagram",
        externalId: "ig_2001",
        author: "neon.lights.official",
        authorId: "ig_neon",
        content: "Night city vibez 🌆✨\n\n#cyberpunk #neon #nightphotography",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":8900,\"comments\":156}",
        platformMetadata: "{\"image_url\":\"https://images.unsplash.com/photo-1555680202-c86f0e12f086?w=800&q=80\",\"mediaType\":\"image\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 482),
        updatedAt: new Date(),
      },
      {
        id: 10,
        platform: "instagram",
        externalId: "ig_2002",
        author: "ui.daily.inspo",
        authorId: "ig_ui",
        content: "Minimalism meets Cyberpunk. What do you think of this dark mode dashboard? 💻",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":4500,\"comments\":89}",
        platformMetadata: "{\"image_url\":\"https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80\",\"mediaType\":\"image\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 283),
        updatedAt: new Date(),
      },
      {
        id: 11,
        platform: "instagram",
        externalId: "ig_2003",
        author: "tech.setup.world",
        authorId: "ig_setup",
        content: "Rate this WFH setup 1-10! 🔥 The ultra-wide monitor is a game changer for productivity.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":12400,\"comments\":342}",
        platformMetadata: "{\"image_url\":\"https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=800&q=80\",\"mediaType\":\"image\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 134),
        updatedAt: new Date(),
      },
      {
        id: 12,
        platform: "instagram",
        externalId: "ig_2004",
        author: "coder.lifestyle",
        authorId: "ig_coder",
        content: "Late night coding sessions require good coffee and lofi beats. ☕🎧",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":3200,\"comments\":45}",
        platformMetadata: "{\"image_url\":\"https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&q=80\",\"mediaType\":\"image\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 722),
        updatedAt: new Date(),
      },
      {
        id: 13,
        platform: "bluesky",
        externalId: "bsky_1",
        author: "tech_guru.bsky.social",
        authorId: "bsky_u1",
        content: "The AT Protocol is fascinating. Built a custom feed yesterday and it was surprisingly easy.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":340,\"reposts\":56,\"replies\":23}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 1244),
        updatedAt: new Date(),
      },
      {
        id: 14,
        platform: "bluesky",
        externalId: "bsky_2",
        author: "alice.dev",
        authorId: "bsky_u2",
        content: "Hello decentralized world! Just migrated from the bird app.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":1200,\"reposts\":150,\"replies\":80}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 1244),
        updatedAt: new Date(),
      },
      {
        id: 15,
        platform: "bluesky",
        externalId: "bsky_3",
        author: "web_standards",
        authorId: "bsky_u3",
        content: "Reminder: use semantic HTML! It makes your site accessible and easier to parse.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":450,\"reposts\":89,\"replies\":12}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 907),
        updatedAt: new Date(),
      },
      {
        id: 16,
        platform: "bluesky",
        externalId: "bsky_4",
        author: "daily_hacks",
        authorId: "bsky_u4",
        content: "Did you know you can use css variables to easily create a dark mode toggle?",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":890,\"reposts\":120,\"replies\":34}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 155),
        updatedAt: new Date(),
      },
      {
        id: 17,
        platform: "threads",
        externalId: "th_1",
        author: "meta.dev",
        authorId: "th_u1",
        content: "We're testing some new features for better algorithmic curation. Stay tuned.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":5600,\"replies\":450}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 384),
        updatedAt: new Date(),
      },
      {
        id: 18,
        platform: "threads",
        externalId: "th_2",
        author: "react.enthusiast",
        authorId: "th_u2",
        content: "Server components are finally clicking for me. The performance benefits are real.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":890,\"replies\":120}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 509),
        updatedAt: new Date(),
      },
      {
        id: 19,
        platform: "threads",
        externalId: "th_3",
        author: "design.trends",
        authorId: "th_u3",
        content: "Skeuomorphism is making a subtle comeback. Thoughts?",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":1200,\"replies\":340}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 1265),
        updatedAt: new Date(),
      },
      {
        id: 20,
        platform: "threads",
        externalId: "th_4",
        author: "startup.founder",
        authorId: "th_u4",
        content: "Just launched our beta. The response has been overwhelming. Thank you everyone!",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"likes\":3400,\"replies\":560}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 428),
        updatedAt: new Date(),
      },
      {
        id: 21,
        platform: "twitch",
        externalId: "twch_1",
        author: "CodingStreamer",
        authorId: "twch_u1",
        content: "Live coding session",
        title: "Building a React App from Scratch! !commands",
        contentWarning: null,
        engagementMetrics: "{\"viewers\":1200}",
        platformMetadata: "{\"isLive\":true,\"game\":\"Software and Game Development\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 145),
        updatedAt: new Date(),
      },
      {
        id: 22,
        platform: "twitch",
        externalId: "twch_2",
        author: "ProGamer",
        authorId: "twch_u2",
        content: "Gaming stream",
        title: "Ranked Climb to Grandmaster | Chill vibes",
        contentWarning: null,
        engagementMetrics: "{\"viewers\":4500}",
        platformMetadata: "{\"isLive\":true,\"game\":\"Valorant\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 208),
        updatedAt: new Date(),
      },
      {
        id: 23,
        platform: "twitch",
        externalId: "twch_3",
        author: "MusicProducer",
        authorId: "twch_u3",
        content: "Music production",
        title: "Making beats live | Sub Saturday",
        contentWarning: null,
        engagementMetrics: "{\"views\":89000,\"duration\":\"3:45:00\"}",
        platformMetadata: "{\"isLive\":false,\"game\":\"Music\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 661),
        updatedAt: new Date(),
      },
      {
        id: 24,
        platform: "twitch",
        externalId: "twch_4",
        author: "DevTalks",
        authorId: "twch_u4",
        content: "Tech interview",
        title: "Interview with the creator of Vite",
        contentWarning: null,
        engagementMetrics: "{\"views\":120000,\"duration\":\"1:20:00\"}",
        platformMetadata: "{\"isLive\":false,\"game\":\"Just Chatting\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 735),
        updatedAt: new Date(),
      },
      {
        id: 25,
        platform: "mastodon",
        externalId: "mstd_1",
        author: "foss_lover",
        authorId: "mstd_u1",
        content: "Just discovered this new open-source alternative to notion. It's incredibly fast.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"favs\":340,\"boosts\":89,\"replies\":23}",
        platformMetadata: "{\"did\":\"mastodon.social\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 532),
        updatedAt: new Date(),
      },
      {
        id: 26,
        platform: "mastodon",
        externalId: "mstd_2",
        author: "linux_nerd",
        authorId: "mstd_u2",
        content: "Year of the linux desktop is here (again). Honestly, Proton makes gaming on Linux a breeze.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"favs\":890,\"boosts\":230,\"replies\":120}",
        platformMetadata: "{\"did\":\"fosstodon.org\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 391),
        updatedAt: new Date(),
      },
      {
        id: 27,
        platform: "mastodon",
        externalId: "mstd_3",
        author: "privacy_advocate",
        authorId: "mstd_u3",
        content: "Remember to regularly review your app permissions. You'd be surprised what you've agreed to.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"favs\":1200,\"boosts\":450,\"replies\":80}",
        platformMetadata: "{\"did\":\"infosec.exchange\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 1028),
        updatedAt: new Date(),
      },
      {
        id: 28,
        platform: "mastodon",
        externalId: "mstd_4",
        author: "indie_web",
        authorId: "mstd_u4",
        content: "Own your data. Host your own blog. Decentralize.",
        title: null,
        contentWarning: null,
        engagementMetrics: "{\"favs\":560,\"boosts\":120,\"replies\":45}",
        platformMetadata: "{\"did\":\"mastodon.social\"}",
        createdAt: new Date(Date.now() - 1000 * 60 * 1124),
        updatedAt: new Date(),
      },
      {
        id: 29,
        platform: "youtube",
        externalId: "yt_1",
        author: "Tech Reviews",
        authorId: "yt_u1",
        content: "Reviewing the best monitors, keyboards, and mice for programmers.",
        title: "The Ultimate Developer Setup 2026",
        contentWarning: null,
        engagementMetrics: "{\"views\":1500000,\"likes\":45000,\"comments\":3200}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 203),
        updatedAt: new Date(),
      },
      {
        id: 30,
        platform: "youtube",
        externalId: "yt_2",
        author: "Code Academy",
        authorId: "yt_u2",
        content: "A crash course on TypeScript for beginners.",
        title: "Learn TypeScript in 1 Hour",
        contentWarning: null,
        engagementMetrics: "{\"views\":500000,\"likes\":23000,\"comments\":1200}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 521),
        updatedAt: new Date(),
      },
      {
        id: 31,
        platform: "youtube",
        externalId: "yt_3",
        author: "Design Masters",
        authorId: "yt_u3",
        content: "Analyzing the psychological and practical benefits of dark mode.",
        title: "Why Dark Mode is the Future of UI",
        contentWarning: null,
        engagementMetrics: "{\"views\":890000,\"likes\":34000,\"comments\":2100}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 919),
        updatedAt: new Date(),
      },
      {
        id: 32,
        platform: "youtube",
        externalId: "yt_4",
        author: "Vlog Life",
        authorId: "yt_u4",
        content: "Follow me around as I code, eat, and explore the city.",
        title: "Day in the life of a Software Engineer in Tokyo",
        contentWarning: null,
        engagementMetrics: "{\"views\":2500000,\"likes\":120000,\"comments\":8900}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 89),
        updatedAt: new Date(),
      },
      {
        id: 33,
        platform: "github",
        externalId: "gh_1",
        author: "facebook",
        authorId: "gh_u1",
        content: "The library for web and native user interfaces.",
        title: "react",
        contentWarning: null,
        engagementMetrics: "{\"stars\":215000,\"forks\":45000}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 940),
        updatedAt: new Date(),
      },
      {
        id: 34,
        platform: "github",
        externalId: "gh_2",
        author: "torvalds",
        authorId: "gh_u2",
        content: "Linux kernel source tree",
        title: "linux",
        contentWarning: null,
        engagementMetrics: "{\"stars\":165000,\"forks\":52000}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 168),
        updatedAt: new Date(),
      },
      {
        id: 35,
        platform: "github",
        externalId: "gh_3",
        author: "microsoft",
        authorId: "gh_u3",
        content: "Visual Studio Code",
        title: "vscode",
        contentWarning: null,
        engagementMetrics: "{\"stars\":153000,\"forks\":26000}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 453),
        updatedAt: new Date(),
      },
      {
        id: 36,
        platform: "github",
        externalId: "gh_4",
        author: "vercel",
        authorId: "gh_u4",
        content: "The React Framework",
        title: "next.js",
        contentWarning: null,
        engagementMetrics: "{\"stars\":115000,\"forks\":24000}",
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 1086),
        updatedAt: new Date(),
      },
    ];

    let filtered = mockFeedPosts;
    if (options?.platform && options.platform !== 'all') {
      filtered = mockFeedPosts.filter(p => p.platform === options.platform);
    }
    
    return {
        items: filtered,
        nextCursor: undefined
    };
  }

  try {
    const baseQuery = db.select().from(feedPosts);
    
    const whereClause = options?.platform && options.platform !== 'all'
      ? baseQuery.where(eq(feedPosts.platform, options.platform))
      : baseQuery;
    
    const orderedQuery = whereClause.orderBy(desc(feedPosts.createdAt));
    
    const limitedQuery = limit
      ? orderedQuery.limit(limit)
      : orderedQuery;
    
    const finalQuery = offset
      ? limitedQuery.offset(offset)
      : limitedQuery;

    const items = await finalQuery;
    return {
        items,
        nextCursor: items.length >= limit ? String(offset + limit) : undefined
    };
  } catch (error) {
    console.error("[Database] Failed to get feed posts:", error);
    return { items: [], nextCursor: undefined };
  }
}

/**
 * Get user preferences
 */
export async function getUserPreferences(userId: number): Promise<UserPreference | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user preferences: database not available");
    return null;
  }

  try {
    const result = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get user preferences:", error);
    return null;
  }
}

/**
 * Upsert user preferences
 */
export async function upsertUserPreferences(
  userId: number,
  prefs: Partial<InsertUserPreference>
): Promise<UserPreference | null> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user preferences: database not available");
    return null;
  }

  try {
    const values: InsertUserPreference = {
      userId,
      ...prefs,
    };

    await db
      .insert(userPreferences)
      .values(values)
      .onDuplicateKeyUpdate({
        set: prefs,
      });

    return await getUserPreferences(userId);
  } catch (error) {
    console.error("[Database] Failed to upsert user preferences:", error);
    return null;
  }
}
