import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
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
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Feed posts from aggregated social media platforms
 */
export const feedPosts = mysqlTable("feedPosts", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FeedPost = typeof feedPosts.$inferSelect;
export type InsertFeedPost = typeof feedPosts.$inferInsert;

/**
 * User preferences for feed filtering and aggregation
 */
export const userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  enabledPlatforms: text("enabledPlatforms"),
  defaultFilter: varchar("defaultFilter", { length: 32 }).default("all"),
  itemsPerPage: int("itemsPerPage").default(20),
  sortBy: varchar("sortBy", { length: 32 }).default("recent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;
