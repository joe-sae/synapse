import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getFeedPosts, getUserPreferences, upsertUserPreferences } from "./db";
import { z } from "zod";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  feed: router({
    getPosts: publicProcedure
      .input(z.object({
        platform: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().nullish(),
      }))
      .query(async ({ input }) => {
        const limit = input.limit || 20;
        const cursor = input.cursor ?? undefined;

        const result = await getFeedPosts({
          platform: input.platform,
          limit,
          cursor,
        });

        return {
          items: result.items,
          nextCursor: result.nextCursor ?? null,
        };
      }),
  }),

  preferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return await getUserPreferences(ctx.user.id);
    }),

    update: protectedProcedure
      .input(z.object({
        enabledPlatforms: z.array(z.string()).optional(),
        defaultFilter: z.string().optional(),
        itemsPerPage: z.number().optional(),
        sortBy: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const prefs = {
          enabledPlatforms: input.enabledPlatforms ? JSON.stringify(input.enabledPlatforms) : undefined,
          defaultFilter: input.defaultFilter,
          itemsPerPage: input.itemsPerPage,
          sortBy: input.sortBy,
        };
        return await upsertUserPreferences(ctx.user.id, prefs);
      }),
  }),

  // New Backend Features for Footer Actions
  chat: router({
    getUnreadCount: publicProcedure.query(() => {
      // Mock data for unread messages
      return { count: 3 };
    }),
    getConversations: publicProcedure.query(() => {
      // Mock data for recent conversations
      return [
        { id: 1, user: 'neon_dreams', lastMessage: 'Did you see the new update?', timestamp: '5m ago' },
        { id: 2, user: 'cyber_punk', lastMessage: 'Let\'s collaborate on the neural link project.', timestamp: '1h ago' }
      ];
    }),
  }),

  search: router({
    query: publicProcedure
      .input(z.object({ q: z.string() }))
      .query(({ input }) => {
        // Mock search results
        return {
          results: [
            { id: 101, type: 'post', title: `Result for "${input.q}" 1` },
            { id: 102, type: 'user', name: `@${input.q}_user` }
          ]
        };
      })
  }),

  userProfile: router({
    getStats: publicProcedure.query(() => {
      // Mock user statistics
      return {
        followers: 1205,
        following: 340,
        posts: 89,
        reputationScore: 99.2
      };
    })
  }),

  posts: router({
    create: protectedProcedure
      .input(z.object({
        content: z.string().min(1),
        platform: z.string().optional()
      }))
      .mutation(({ input, ctx }) => {
        // Mock post creation logic
        return {
          success: true,
          postId: Math.floor(Math.random() * 10000),
          message: `Post created successfully on ${input.platform || 'SYNAPSE'}`
        };
      })
  })
});

export type AppRouter = typeof appRouter;
