import { FeedPost } from "../../drizzle/schema";

export async function fetchGithubFeed(username: string, limit = 20, page = 1): Promise<Partial<FeedPost>[]> {
  try {
    const res = await fetch(`https://api.github.com/users/${username}/events/public?per_page=${limit}&page=${page}`);
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch GitHub events: ${res.status} ${res.statusText} - ${errorText}`);
    }
    const events = (await res.json()) as any[];
    
    return events.map((event: any) => {
      let content = "";
      let title = "";
      
      switch(event.type) {
        case "PushEvent":
          title = `Pushed to ${event.repo.name}`;
          content = event.payload.commits?.[0]?.message || "Pushed code changes";
          break;
        case "CreateEvent":
          title = `Created ${event.payload.ref_type} ${event.payload.ref || ''} in ${event.repo.name}`;
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
        content: content,
        title: title,
        engagementMetrics: JSON.stringify({
          stars: 0,
          forks: 0,
        }),
        platformMetadata: JSON.stringify({
          repo: event.repo.name,
          avatar: event.actor.avatar_url,
        }),
        createdAt: new Date(event.created_at),
      };
    });
  } catch (error) {
    console.error("Error fetching GitHub feed:", error);
    return [];
  }
}
