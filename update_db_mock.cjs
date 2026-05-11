const fs = require('fs');

const basePosts = [
  // Twitter Mock Posts
  { platform: "twitter", externalId: "tw_1001", author: "@cyber_punk", authorId: "user_cyber", content: "Just configured my neovim with Lua. It's blazing fast. #cyberpunk #coding", engagementMetrics: JSON.stringify({ likes: 420, retweets: 69, replies: 12 }), platformMetadata: JSON.stringify({ verified: true }) },
  { platform: "twitter", externalId: "tw_1002", author: "@neon_dreams", authorId: "user_neon", content: "The aesthetic of Blade Runner never gets old. We need more neon in UI design. Minimalist and dark.", engagementMetrics: JSON.stringify({ likes: 1337, retweets: 256, replies: 42 }) },
  { platform: "twitter", externalId: "tw_1003", author: "@frontend_dev", authorId: "user_fe", content: "Tailwind v4 is out and it's incredible. The new engine is so much faster. #webdev", engagementMetrics: JSON.stringify({ likes: 892, retweets: 120, replies: 34 }) },
  { platform: "twitter", externalId: "tw_1004", author: "@sys_admin", authorId: "user_sys", content: "Server migrations at 3 AM hit different. Coffee and logs. #devops", engagementMetrics: JSON.stringify({ likes: 156, retweets: 24, replies: 8 }) },

  // Facebook Mock Posts
  { platform: "facebook", externalId: "fb_1", author: "Tech Enthusiasts Group", authorId: "fb_u1", content: "Check out this new framework for building desktop apps with React! Has anyone tried it yet?", engagementMetrics: JSON.stringify({ likes: 340, comments: 85, shares: 20 }) },
  { platform: "facebook", externalId: "fb_2", author: "Cyber Security News", authorId: "fb_u2", content: "A major vulnerability has been found in older routers. Make sure to patch your devices ASAP to prevent unauthorized access.", engagementMetrics: JSON.stringify({ likes: 890, comments: 230, shares: 450 }) },
  { platform: "facebook", externalId: "fb_3", author: "Jane Doe", authorId: "fb_u3", content: "Finally finished my setup! Dual 4K monitors and a mechanical keyboard. So happy right now.", engagementMetrics: JSON.stringify({ likes: 120, comments: 15 }) },
  { platform: "facebook", externalId: "fb_4", author: "Web Dev Bootcamps", authorId: "fb_u4", content: "New cohort starting next week! Learn full-stack development in 12 weeks. Apply now.", engagementMetrics: JSON.stringify({ likes: 56, comments: 12, shares: 5 }) },

  // Instagram Mock Posts
  { platform: "instagram", externalId: "ig_2001", author: "neon.lights.official", authorId: "ig_neon", content: "Night city vibez 🌆✨\n\n#cyberpunk #neon #nightphotography", engagementMetrics: JSON.stringify({ likes: 8900, comments: 156 }), platformMetadata: JSON.stringify({ image_url: "https://images.unsplash.com/photo-1555680202-c86f0e12f086?w=800&q=80", mediaType: "image" }) },
  { platform: "instagram", externalId: "ig_2002", author: "ui.daily.inspo", authorId: "ig_ui", content: "Minimalism meets Cyberpunk. What do you think of this dark mode dashboard? 💻", engagementMetrics: JSON.stringify({ likes: 4500, comments: 89 }), platformMetadata: JSON.stringify({ image_url: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80", mediaType: "image" }) },
  { platform: "instagram", externalId: "ig_2003", author: "tech.setup.world", authorId: "ig_setup", content: "Rate this WFH setup 1-10! 🔥 The ultra-wide monitor is a game changer for productivity.", engagementMetrics: JSON.stringify({ likes: 12400, comments: 342 }), platformMetadata: JSON.stringify({ image_url: "https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=800&q=80", mediaType: "image" }) },
  { platform: "instagram", externalId: "ig_2004", author: "coder.lifestyle", authorId: "ig_coder", content: "Late night coding sessions require good coffee and lofi beats. ☕🎧", engagementMetrics: JSON.stringify({ likes: 3200, comments: 45 }), platformMetadata: JSON.stringify({ image_url: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&q=80", mediaType: "image" }) },

  // Bluesky Mock Posts
  { platform: "bluesky", externalId: "bsky_1", author: "tech_guru.bsky.social", authorId: "bsky_u1", content: "The AT Protocol is fascinating. Built a custom feed yesterday and it was surprisingly easy.", engagementMetrics: JSON.stringify({ likes: 340, reposts: 56, replies: 23 }) },
  { platform: "bluesky", externalId: "bsky_2", author: "alice.dev", authorId: "bsky_u2", content: "Hello decentralized world! Just migrated from the bird app.", engagementMetrics: JSON.stringify({ likes: 1200, reposts: 150, replies: 80 }) },
  { platform: "bluesky", externalId: "bsky_3", author: "web_standards", authorId: "bsky_u3", content: "Reminder: use semantic HTML! It makes your site accessible and easier to parse.", engagementMetrics: JSON.stringify({ likes: 450, reposts: 89, replies: 12 }) },
  { platform: "bluesky", externalId: "bsky_4", author: "daily_hacks", authorId: "bsky_u4", content: "Did you know you can use css variables to easily create a dark mode toggle?", engagementMetrics: JSON.stringify({ likes: 890, reposts: 120, replies: 34 }) },

  // Threads Mock Posts
  { platform: "threads", externalId: "th_1", author: "meta.dev", authorId: "th_u1", content: "We're testing some new features for better algorithmic curation. Stay tuned.", engagementMetrics: JSON.stringify({ likes: 5600, replies: 450 }) },
  { platform: "threads", externalId: "th_2", author: "react.enthusiast", authorId: "th_u2", content: "Server components are finally clicking for me. The performance benefits are real.", engagementMetrics: JSON.stringify({ likes: 890, replies: 120 }) },
  { platform: "threads", externalId: "th_3", author: "design.trends", authorId: "th_u3", content: "Skeuomorphism is making a subtle comeback. Thoughts?", engagementMetrics: JSON.stringify({ likes: 1200, replies: 340 }) },
  { platform: "threads", externalId: "th_4", author: "startup.founder", authorId: "th_u4", content: "Just launched our beta. The response has been overwhelming. Thank you everyone!", engagementMetrics: JSON.stringify({ likes: 3400, replies: 560 }) },

  // Twitch Mock Posts
  { platform: "twitch", externalId: "twch_1", author: "CodingStreamer", authorId: "twch_u1", title: "Building a React App from Scratch! !commands", content: "Live coding session", platformMetadata: JSON.stringify({ isLive: true, game: "Software and Game Development" }), engagementMetrics: JSON.stringify({ viewers: 1200 }) },
  { platform: "twitch", externalId: "twch_2", author: "ProGamer", authorId: "twch_u2", title: "Ranked Climb to Grandmaster | Chill vibes", content: "Gaming stream", platformMetadata: JSON.stringify({ isLive: true, game: "Valorant" }), engagementMetrics: JSON.stringify({ viewers: 4500 }) },
  { platform: "twitch", externalId: "twch_3", author: "MusicProducer", authorId: "twch_u3", title: "Making beats live | Sub Saturday", content: "Music production", platformMetadata: JSON.stringify({ isLive: false, game: "Music" }), engagementMetrics: JSON.stringify({ views: 89000, duration: "3:45:00" }) },
  { platform: "twitch", externalId: "twch_4", author: "DevTalks", authorId: "twch_u4", title: "Interview with the creator of Vite", content: "Tech interview", platformMetadata: JSON.stringify({ isLive: false, game: "Just Chatting" }), engagementMetrics: JSON.stringify({ views: 120000, duration: "1:20:00" }) },

  // Mastodon Mock Posts
  { platform: "mastodon", externalId: "mstd_1", author: "foss_lover", authorId: "mstd_u1", content: "Just discovered this new open-source alternative to notion. It's incredibly fast.", engagementMetrics: JSON.stringify({ favs: 340, boosts: 89, replies: 23 }), platformMetadata: JSON.stringify({ did: "mastodon.social" }) },
  { platform: "mastodon", externalId: "mstd_2", author: "linux_nerd", authorId: "mstd_u2", content: "Year of the linux desktop is here (again). Honestly, Proton makes gaming on Linux a breeze.", engagementMetrics: JSON.stringify({ favs: 890, boosts: 230, replies: 120 }), platformMetadata: JSON.stringify({ did: "fosstodon.org" }) },
  { platform: "mastodon", externalId: "mstd_3", author: "privacy_advocate", authorId: "mstd_u3", content: "Remember to regularly review your app permissions. You'd be surprised what you've agreed to.", engagementMetrics: JSON.stringify({ favs: 1200, boosts: 450, replies: 80 }), platformMetadata: JSON.stringify({ did: "infosec.exchange" }) },
  { platform: "mastodon", externalId: "mstd_4", author: "indie_web", authorId: "mstd_u4", content: "Own your data. Host your own blog. Decentralize.", engagementMetrics: JSON.stringify({ favs: 560, boosts: 120, replies: 45 }), platformMetadata: JSON.stringify({ did: "mastodon.social" }) },

  // YouTube Mock Posts
  { platform: "youtube", externalId: "yt_1", author: "Tech Reviews", authorId: "yt_u1", title: "The Ultimate Developer Setup 2026", content: "Reviewing the best monitors, keyboards, and mice for programmers.", engagementMetrics: JSON.stringify({ views: 1500000, likes: 45000, comments: 3200 }) },
  { platform: "youtube", externalId: "yt_2", author: "Code Academy", authorId: "yt_u2", title: "Learn TypeScript in 1 Hour", content: "A crash course on TypeScript for beginners.", engagementMetrics: JSON.stringify({ views: 500000, likes: 23000, comments: 1200 }) },
  { platform: "youtube", externalId: "yt_3", author: "Design Masters", authorId: "yt_u3", title: "Why Dark Mode is the Future of UI", content: "Analyzing the psychological and practical benefits of dark mode.", engagementMetrics: JSON.stringify({ views: 890000, likes: 34000, comments: 2100 }) },
  { platform: "youtube", externalId: "yt_4", author: "Vlog Life", authorId: "yt_u4", title: "Day in the life of a Software Engineer in Tokyo", content: "Follow me around as I code, eat, and explore the city.", engagementMetrics: JSON.stringify({ views: 2500000, likes: 120000, comments: 8900 }) },

  // GitHub Mock Posts
  { platform: "github", externalId: "gh_1", author: "facebook", authorId: "gh_u1", title: "react", content: "The library for web and native user interfaces.", engagementMetrics: JSON.stringify({ stars: 215000, forks: 45000 }) },
  { platform: "github", externalId: "gh_2", author: "torvalds", authorId: "gh_u2", title: "linux", content: "Linux kernel source tree", engagementMetrics: JSON.stringify({ stars: 165000, forks: 52000 }) },
  { platform: "github", externalId: "gh_3", author: "microsoft", authorId: "gh_u3", title: "vscode", content: "Visual Studio Code", engagementMetrics: JSON.stringify({ stars: 153000, forks: 26000 }) },
  { platform: "github", externalId: "gh_4", author: "vercel", authorId: "gh_u4", title: "next.js", content: "The React Framework", engagementMetrics: JSON.stringify({ stars: 115000, forks: 24000 }) }
];

let generatedStr = "    const mockFeedPosts: FeedPost[] = [\n";
let id = 1;
for (const p of basePosts) {
  generatedStr += `      {
        id: ${id++},
        platform: "${p.platform}",
        externalId: "${p.externalId}",
        author: "${p.author}",
        authorId: "${p.authorId}",
        content: ${JSON.stringify(p.content)},
        title: ${p.title ? JSON.stringify(p.title) : "null"},
        contentWarning: null,
        engagementMetrics: ${p.engagementMetrics ? JSON.stringify(p.engagementMetrics) : "null"},
        platformMetadata: ${p.platformMetadata ? JSON.stringify(p.platformMetadata) : "null"},
        createdAt: new Date(Date.now() - 1000 * 60 * ${Math.floor(Math.random() * 60 * 24)}),
        updatedAt: new Date(),
      },\n`;
}
generatedStr += "    ];";

const dbPath = 'server/db.ts';
let dbContent = fs.readFileSync(dbPath, 'utf-8');

const startStr = "const mockFeedPosts: FeedPost[] = [";
const endStr = "    ];\n\n    let filtered = mockFeedPosts;";

const startIndex = dbContent.indexOf(startStr);
const endIndex = dbContent.indexOf(endStr);

if (startIndex !== -1 && endIndex !== -1) {
  const newContent = dbContent.substring(0, startIndex) + generatedStr + "\n\n    let filtered = mockFeedPosts;" + dbContent.substring(endIndex + endStr.length);
  fs.writeFileSync(dbPath, newContent);
  console.log("Replaced mock data in db.ts successfully");
} else {
  console.error("Could not find start/end string in db.ts");
}
