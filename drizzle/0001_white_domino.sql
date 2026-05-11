CREATE TABLE `feedPosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` varchar(32) NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`author` varchar(255) NOT NULL,
	`authorId` varchar(255),
	`content` text,
	`title` varchar(500),
	`contentWarning` varchar(255),
	`engagementMetrics` text,
	`platformMetadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feedPosts_id` PRIMARY KEY(`id`),
	CONSTRAINT `feedPosts_externalId_unique` UNIQUE(`externalId`)
);
--> statement-breakpoint
CREATE TABLE `userPreferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`enabledPlatforms` text,
	`defaultFilter` varchar(32) DEFAULT 'all',
	`itemsPerPage` int DEFAULT 20,
	`sortBy` varchar(32) DEFAULT 'recent',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userPreferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `userPreferences` ADD CONSTRAINT `userPreferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;