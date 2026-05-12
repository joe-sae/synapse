// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var feedPosts = mysqlTable("feedPosts", {
  id: int("id").autoincrement().primaryKey(),
  platform: varchar("platform", { length: 32 }).notNull(),
  externalId: varchar("externalId", { length: 255 }).notNull().unique(),
  author: varchar("author", { length: 255 }).notNull(),
  authorId: varchar("authorId", { length: 255 }),
  content: text("content"),
  title: varchar("title", { length: 500 }),
  contentWarning: varchar("contentWarning", { length: 255 }),
  engagementMetrics: text("engagementMetrics"),
  platformMetadata: text("platformMetadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  enabledPlatforms: text("enabledPlatforms"),
  defaultFilter: varchar("defaultFilter", { length: 32 }).default("all"),
  itemsPerPage: int("itemsPerPage").default(20),
  sortBy: varchar("sortBy", { length: 32 }).default("recent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  blueskyHandle: process.env.BLUESKY_HANDLE ?? "",
  blueskyPassword: process.env.BLUESKY_PASSWORD ?? "",
  newsApiKey: process.env.NEWS_API_KEY ?? ""
};

// server/services/bluesky.ts
async function fetchBlueskyFeed(handle, limit = 20, cursor) {
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
    if (cursorType === "discover") {
      console.log(`[Bluesky] Fetching discover feed with cursor: ${realCursor}`);
      const res = await fetchBlueskyDiscoverFeed(limit, realCursor);
      return {
        posts: res.posts,
        cursor: res.cursor ? `discover:${res.cursor}` : void 0
      };
    }
    const resolveRes = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
    console.log(`[Bluesky] Resolving handle: ${handle}, Status: ${resolveRes.status}`);
    if (!resolveRes.ok) {
      const errorText = await resolveRes.text();
      console.error(`[Bluesky] Resolution failed: ${errorText}`);
      throw new Error(`Failed to resolve handle: ${resolveRes.status} ${resolveRes.statusText} - ${errorText}`);
    }
    const resolveData = await resolveRes.json();
    const did = resolveData.did;
    console.log(`[Bluesky] Resolved DID: ${did}`);
    if (!did) {
      throw new Error("Could not resolve handle to DID");
    }
    let url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}&limit=${limit}`;
    if (realCursor) {
      url += `&cursor=${encodeURIComponent(realCursor)}`;
    }
    const feedRes = await fetch(url);
    console.log(`[Bluesky] Fetching author feed: Status: ${feedRes.status}`);
    if (!feedRes.ok) {
      const errorText = await feedRes.text();
      console.error(`[Bluesky] Author feed fetch failed: ${errorText}`);
    } else {
      const feedData = await feedRes.json();
      console.log(`[Bluesky] Author feed returned ${feedData.feed.length} posts`);
      if (feedData.feed.length > 0) {
        const posts = mapBlueskyPosts(feedData.feed);
        return {
          posts,
          // Prefix the returned cursor with "author:"
          cursor: feedData.cursor ? `author:${feedData.cursor}` : void 0
        };
      }
    }
    console.log(`[Bluesky] Author feed empty, fetching Discover feed from beginning`);
    const discoverRes = await fetchBlueskyDiscoverFeed(limit, void 0);
    return {
      posts: discoverRes.posts,
      cursor: discoverRes.cursor ? `discover:${discoverRes.cursor}` : void 0
    };
  } catch (error) {
    console.error("Error fetching Bluesky feed:", error);
    try {
      const discoverRes = await fetchBlueskyDiscoverFeed(limit, void 0);
      return {
        posts: discoverRes.posts,
        cursor: discoverRes.cursor ? `discover:${discoverRes.cursor}` : void 0
      };
    } catch {
      return { posts: [] };
    }
  }
}
async function fetchBlueskyDiscoverFeed(limit = 20, cursor) {
  try {
    const feedUri = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/discover";
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
    const data = await res.json();
    console.log(`[Bluesky] Discover returned ${data.feed.length} posts`);
    const posts = mapBlueskyPosts(data.feed);
    return { posts, cursor: data.cursor };
  } catch (error) {
    console.error("[Bluesky] Discover feed error:", error);
    return { posts: [] };
  }
}
function mapBlueskyPosts(feed) {
  return feed.map((item) => {
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
        replies: post.replyCount || 0
      }),
      platformMetadata: JSON.stringify({
        did: post.author.did,
        avatar: post.author.avatar,
        uri: post.uri
      }),
      createdAt: new Date(record.createdAt)
    };
  });
}

// server/services/github.ts
async function fetchGithubFeed(username, limit = 20, page = 1) {
  try {
    const res = await fetch(`https://api.github.com/users/${username}/events/public?per_page=${limit}&page=${page}`);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to fetch GitHub events: ${res.status} ${res.statusText} - ${errorText}`);
    }
    const events = await res.json();
    return events.map((event) => {
      let content = "";
      let title = "";
      switch (event.type) {
        case "PushEvent":
          title = `Pushed to ${event.repo.name}`;
          content = event.payload.commits?.[0]?.message || "Pushed code changes";
          break;
        case "CreateEvent":
          title = `Created ${event.payload.ref_type} ${event.payload.ref || ""} in ${event.repo.name}`;
          content = `New ${event.payload.ref_type} created.`;
          break;
        case "WatchEvent":
          title = `Starred ${event.repo.name}`;
          content = "Added repository to favorites.";
          break;
        case "IssueCommentEvent":
          title = `Commented on issue in ${event.repo.name}`;
          content = event.payload.comment.body;
          break;
        default:
          title = `${event.type.replace("Event", "")} in ${event.repo.name}`;
          content = "GitHub activity recorded.";
      }
      return {
        platform: "github",
        externalId: event.id,
        author: event.actor.login,
        authorId: String(event.actor.id),
        content,
        title,
        engagementMetrics: JSON.stringify({
          stars: 0,
          forks: 0
        }),
        platformMetadata: JSON.stringify({
          repo: event.repo.name,
          avatar: event.actor.avatar_url
        }),
        createdAt: new Date(event.created_at)
      };
    });
  } catch (error) {
    console.error("Error fetching GitHub feed:", error);
    return [];
  }
}

// server/services/youtube.ts
async function fetchYoutubeFeed(limit = 20, pageToken) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("[YouTube] YOUTUBE_API_KEY is not configured.");
    return { posts: [] };
  }
  try {
    let url = `https://www.googleapis.com/youtube/v3/videos?chart=mostPopular&regionCode=US&maxResults=${limit}&key=${apiKey}&part=snippet,contentDetails,statistics`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to fetch YouTube data: ${res.status} ${res.statusText} - ${errorText}`);
    }
    const data = await res.json();
    const items = data.items || [];
    const posts = items.map((item) => ({
      platform: "youtube",
      externalId: item.id,
      author: item.snippet.channelTitle,
      authorId: item.snippet.channelId,
      content: item.snippet.description,
      title: item.snippet.title,
      engagementMetrics: JSON.stringify({
        views: parseInt(item.statistics.viewCount) || 0,
        likes: parseInt(item.statistics.likeCount) || 0,
        comments: parseInt(item.statistics.commentCount) || 0
      }),
      platformMetadata: JSON.stringify({
        videoId: item.id,
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        duration: item.contentDetails.duration,
        definition: item.contentDetails.definition
      }),
      createdAt: new Date(item.snippet.publishedAt)
    }));
    return { posts, nextPageToken: data.nextPageToken };
  } catch (error) {
    console.error("Error fetching YouTube feed:", error);
    return { posts: [] };
  }
}

// server/services/news.ts
async function fetchNewsFeed(query = "technology", page = 1, pageSize = 20) {
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
    return data.articles.map((article, index) => ({
      platform: "news",
      externalId: article.url || `news-${Date.now()}-${index}`,
      author: article.author || article.source?.name || "News",
      authorId: article.source?.id || "news-source",
      content: article.description || article.content || "",
      title: article.title,
      engagementMetrics: JSON.stringify({
        source: article.source?.name
      }),
      platformMetadata: JSON.stringify({
        url: article.url,
        urlToImage: article.urlToImage,
        publishedAt: article.publishedAt,
        source: article.source
      }),
      createdAt: new Date(article.publishedAt || Date.now())
    }));
  } catch (error) {
    console.error("Error fetching NewsAPI feed:", error);
    return [];
  }
}

// server/db.ts
var _db = null;
async function getDb() {
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
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getFeedPosts(options) {
  const limit = options?.limit || 20;
  const offset = options?.offset || 0;
  if (options?.platform === "bluesky") {
    const handle = ENV.blueskyHandle || "jay.bsky.team";
    let bskyCursor = options?.cursor;
    if (bskyCursor === "0") bskyCursor = void 0;
    console.log(`[Database] Attempting to fetch live Bluesky feed for handle: ${handle}, cursor: ${bskyCursor}`);
    const { posts: livePosts, cursor: nextCursor } = await fetchBlueskyFeed(handle, limit, bskyCursor);
    console.log(`[Database] Fetched ${livePosts.length} live Bluesky posts`);
    return {
      items: livePosts.map((p) => ({
        id: Math.floor(Math.random() * 1e9),
        updatedAt: /* @__PURE__ */ new Date(),
        createdAt: p.createdAt || /* @__PURE__ */ new Date(),
        ...p
      })),
      nextCursor: nextCursor || "0"
    };
  }
  if (options?.platform === "news") {
    let page = options?.cursor ? parseInt(options.cursor, 10) || 1 : 1;
    if (page < 1) page = 1;
    console.log(`[Database] Attempting to fetch live News feed, page: ${page}`);
    const livePosts = await fetchNewsFeed("technology", page, limit);
    console.log(`[Database] Fetched ${livePosts.length} live News posts`);
    return {
      items: livePosts.map((p) => ({
        id: Math.floor(Math.random() * 1e9),
        updatedAt: /* @__PURE__ */ new Date(),
        createdAt: p.createdAt || /* @__PURE__ */ new Date(),
        ...p
      })),
      // Loop back to page 1 if we didn't get a full page
      nextCursor: livePosts.length >= limit ? String(page + 1) : "1"
    };
  }
  if (options?.platform === "github") {
    const livePosts = await fetchGithubFeed("octocat");
    if (livePosts.length > 0) {
      return {
        items: livePosts.map((p, index) => ({
          id: index + 2e3 + offset,
          updatedAt: /* @__PURE__ */ new Date(),
          createdAt: p.createdAt || /* @__PURE__ */ new Date(),
          ...p
        })),
        nextCursor: "0"
        // Loop back to start
      };
    }
  }
  if (options?.platform === "youtube") {
    let pageToken = options?.cursor;
    if (pageToken === "0") pageToken = void 0;
    const { posts: livePosts, nextPageToken } = await fetchYoutubeFeed(limit, pageToken);
    return {
      items: livePosts.map((p) => ({
        id: Math.floor(Math.random() * 1e9),
        updatedAt: /* @__PURE__ */ new Date(),
        createdAt: p.createdAt || /* @__PURE__ */ new Date(),
        ...p
      })),
      nextCursor: nextPageToken || "0"
      // Loop back to start
    };
  }
  if (!options?.platform || options.platform === "all") {
    const limitPerSource = Math.ceil(limit / 3);
    let ytCursor;
    let bskyCursor;
    let newsPage = 1;
    if (options?.cursor) {
      try {
        const state = JSON.parse(options.cursor);
        ytCursor = state.yt;
        bskyCursor = state.bsky;
        newsPage = state.news || 1;
      } catch (e) {
        newsPage = 1;
      }
    }
    const [ytResult, bskyResult, newsArticles] = await Promise.allSettled([
      fetchYoutubeFeed(limitPerSource, ytCursor),
      fetchBlueskyFeed(ENV.blueskyHandle || "jay.bsky.team", limitPerSource, bskyCursor),
      fetchNewsFeed("technology", newsPage, limitPerSource)
    ]);
    const liveYoutubePosts = ytResult.status === "fulfilled" ? ytResult.value.posts : [];
    const ytNext = ytResult.status === "fulfilled" ? ytResult.value.nextPageToken : void 0;
    const liveBlueskyPosts = bskyResult.status === "fulfilled" ? bskyResult.value.posts : [];
    const bskyNext = bskyResult.status === "fulfilled" ? bskyResult.value.cursor : void 0;
    const liveNewsPosts = newsArticles.status === "fulfilled" ? newsArticles.value : [];
    const newsNextPage = liveNewsPosts.length >= limitPerSource ? newsPage + 1 : 1;
    const allLive = [
      ...liveYoutubePosts.map((p) => ({ id: Math.floor(Math.random() * 1e9), updatedAt: /* @__PURE__ */ new Date(), createdAt: p.createdAt || /* @__PURE__ */ new Date(), ...p })),
      ...liveBlueskyPosts.map((p) => ({ id: Math.floor(Math.random() * 1e9), updatedAt: /* @__PURE__ */ new Date(), createdAt: p.createdAt || /* @__PURE__ */ new Date(), ...p })),
      ...liveNewsPosts.map((p) => ({ id: Math.floor(Math.random() * 1e9), updatedAt: /* @__PURE__ */ new Date(), createdAt: p.createdAt || /* @__PURE__ */ new Date(), ...p }))
    ];
    if (allLive.length > 0) {
      return {
        items: allLive.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        nextCursor: JSON.stringify({ yt: ytNext || "0", bsky: bskyNext || "0", news: newsNextPage })
      };
    } else {
      return {
        items: [],
        nextCursor: JSON.stringify({ yt: "0", bsky: "0", news: 1 })
      };
    }
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get feed posts: database not available. Returning mock data instead.");
    const mockFeedPosts = [
      {
        id: 1,
        platform: "twitter",
        externalId: "tw_1001",
        author: "@cyber_punk",
        authorId: "user_cyber",
        content: "Just configured my neovim with Lua. It's blazing fast. #cyberpunk #coding",
        title: null,
        contentWarning: null,
        engagementMetrics: '{"likes":420,"retweets":69,"replies":12}',
        platformMetadata: '{"verified":true}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 393),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":1337,"retweets":256,"replies":42}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 391),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":892,"retweets":120,"replies":34}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 291),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":156,"retweets":24,"replies":8}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 148),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":340,"comments":85,"shares":20}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 782),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":890,"comments":230,"shares":450}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 1326),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":120,"comments":15}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 589),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":56,"comments":12,"shares":5}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 811),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: 9,
        platform: "instagram",
        externalId: "ig_2001",
        author: "neon.lights.official",
        authorId: "ig_neon",
        content: "Night city vibez \u{1F306}\u2728\n\n#cyberpunk #neon #nightphotography",
        title: null,
        contentWarning: null,
        engagementMetrics: '{"likes":8900,"comments":156}',
        platformMetadata: '{"image_url":"https://images.unsplash.com/photo-1555680202-c86f0e12f086?w=800&q=80","mediaType":"image"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 482),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: 10,
        platform: "instagram",
        externalId: "ig_2002",
        author: "ui.daily.inspo",
        authorId: "ig_ui",
        content: "Minimalism meets Cyberpunk. What do you think of this dark mode dashboard? \u{1F4BB}",
        title: null,
        contentWarning: null,
        engagementMetrics: '{"likes":4500,"comments":89}',
        platformMetadata: '{"image_url":"https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80","mediaType":"image"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 283),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: 11,
        platform: "instagram",
        externalId: "ig_2003",
        author: "tech.setup.world",
        authorId: "ig_setup",
        content: "Rate this WFH setup 1-10! \u{1F525} The ultra-wide monitor is a game changer for productivity.",
        title: null,
        contentWarning: null,
        engagementMetrics: '{"likes":12400,"comments":342}',
        platformMetadata: '{"image_url":"https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=800&q=80","mediaType":"image"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 134),
        updatedAt: /* @__PURE__ */ new Date()
      },
      {
        id: 12,
        platform: "instagram",
        externalId: "ig_2004",
        author: "coder.lifestyle",
        authorId: "ig_coder",
        content: "Late night coding sessions require good coffee and lofi beats. \u2615\u{1F3A7}",
        title: null,
        contentWarning: null,
        engagementMetrics: '{"likes":3200,"comments":45}',
        platformMetadata: '{"image_url":"https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&q=80","mediaType":"image"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 722),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":340,"reposts":56,"replies":23}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 1244),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":1200,"reposts":150,"replies":80}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 1244),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":450,"reposts":89,"replies":12}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 907),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":890,"reposts":120,"replies":34}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 155),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":5600,"replies":450}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 384),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":890,"replies":120}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 509),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":1200,"replies":340}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 1265),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"likes":3400,"replies":560}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 428),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"viewers":1200}',
        platformMetadata: '{"isLive":true,"game":"Software and Game Development"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 145),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"viewers":4500}',
        platformMetadata: '{"isLive":true,"game":"Valorant"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 208),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"views":89000,"duration":"3:45:00"}',
        platformMetadata: '{"isLive":false,"game":"Music"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 661),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"views":120000,"duration":"1:20:00"}',
        platformMetadata: '{"isLive":false,"game":"Just Chatting"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 735),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"favs":340,"boosts":89,"replies":23}',
        platformMetadata: '{"did":"mastodon.social"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 532),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"favs":890,"boosts":230,"replies":120}',
        platformMetadata: '{"did":"fosstodon.org"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 391),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"favs":1200,"boosts":450,"replies":80}',
        platformMetadata: '{"did":"infosec.exchange"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 1028),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"favs":560,"boosts":120,"replies":45}',
        platformMetadata: '{"did":"mastodon.social"}',
        createdAt: new Date(Date.now() - 1e3 * 60 * 1124),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"views":1500000,"likes":45000,"comments":3200}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 203),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"views":500000,"likes":23000,"comments":1200}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 521),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"views":890000,"likes":34000,"comments":2100}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 919),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"views":2500000,"likes":120000,"comments":8900}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 89),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"stars":215000,"forks":45000}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 940),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"stars":165000,"forks":52000}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 168),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"stars":153000,"forks":26000}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 453),
        updatedAt: /* @__PURE__ */ new Date()
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
        engagementMetrics: '{"stars":115000,"forks":24000}',
        platformMetadata: null,
        createdAt: new Date(Date.now() - 1e3 * 60 * 1086),
        updatedAt: /* @__PURE__ */ new Date()
      }
    ];
    let filtered = mockFeedPosts;
    if (options?.platform && options.platform !== "all") {
      filtered = mockFeedPosts.filter((p) => p.platform === options.platform);
    }
    return {
      items: filtered,
      nextCursor: void 0
    };
  }
  try {
    const baseQuery = db.select().from(feedPosts);
    const whereClause = options?.platform && options.platform !== "all" ? baseQuery.where(eq(feedPosts.platform, options.platform)) : baseQuery;
    const orderedQuery = whereClause.orderBy(desc(feedPosts.createdAt));
    const limitedQuery = limit ? orderedQuery.limit(limit) : orderedQuery;
    const finalQuery = offset ? limitedQuery.offset(offset) : limitedQuery;
    const items = await finalQuery;
    return {
      items,
      nextCursor: items.length >= limit ? String(offset + limit) : void 0
    };
  } catch (error) {
    console.error("[Database] Failed to get feed posts:", error);
    return { items: [], nextCursor: void 0 };
  }
}
async function getUserPreferences(userId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user preferences: database not available");
    return null;
  }
  try {
    const result = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("[Database] Failed to get user preferences:", error);
    return null;
  }
}
async function upsertUserPreferences(userId, prefs) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user preferences: database not available");
    return null;
  }
  try {
    const values = {
      userId,
      ...prefs
    };
    await db.insert(userPreferences).values(values).onDuplicateKeyUpdate({
      set: prefs
    });
    return await getUserPreferences(userId);
  } catch (error) {
    console.error("[Database] Failed to upsert user preferences:", error);
    return null;
  }
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { z as z2 } from "zod";
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  feed: router({
    getPosts: publicProcedure.input(z2.object({
      platform: z2.string().optional(),
      limit: z2.number().min(1).max(100).optional(),
      cursor: z2.string().nullish()
    })).query(async ({ input }) => {
      const limit = input.limit || 20;
      const cursor = input.cursor ?? void 0;
      const result = await getFeedPosts({
        platform: input.platform,
        limit,
        cursor
      });
      return {
        items: result.items,
        nextCursor: result.nextCursor ?? null
      };
    })
  }),
  preferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return await getUserPreferences(ctx.user.id);
    }),
    update: protectedProcedure.input(z2.object({
      enabledPlatforms: z2.array(z2.string()).optional(),
      defaultFilter: z2.string().optional(),
      itemsPerPage: z2.number().optional(),
      sortBy: z2.string().optional()
    })).mutation(async ({ ctx, input }) => {
      const prefs = {
        enabledPlatforms: input.enabledPlatforms ? JSON.stringify(input.enabledPlatforms) : void 0,
        defaultFilter: input.defaultFilter,
        itemsPerPage: input.itemsPerPage,
        sortBy: input.sortBy
      };
      return await upsertUserPreferences(ctx.user.id, prefs);
    })
  }),
  // New Backend Features for Footer Actions
  chat: router({
    getUnreadCount: publicProcedure.query(() => {
      return { count: 3 };
    }),
    getConversations: publicProcedure.query(() => {
      return [
        { id: 1, user: "neon_dreams", lastMessage: "Did you see the new update?", timestamp: "5m ago" },
        { id: 2, user: "cyber_punk", lastMessage: "Let's collaborate on the neural link project.", timestamp: "1h ago" }
      ];
    })
  }),
  search: router({
    query: publicProcedure.input(z2.object({ q: z2.string() })).query(({ input }) => {
      return {
        results: [
          { id: 101, type: "post", title: `Result for "${input.q}" 1` },
          { id: 102, type: "user", name: `@${input.q}_user` }
        ]
      };
    })
  }),
  userProfile: router({
    getStats: publicProcedure.query(() => {
      return {
        followers: 1205,
        following: 340,
        posts: 89,
        reputationScore: 99.2
      };
    })
  }),
  posts: router({
    create: protectedProcedure.input(z2.object({
      content: z2.string().min(1),
      platform: z2.string().optional()
    })).mutation(({ input, ctx }) => {
      return {
        success: true,
        postId: Math.floor(Math.random() * 1e4),
        message: `Post created successfully on ${input.platform || "SYNAPSE"}`
      };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ]
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        process.cwd(),
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
