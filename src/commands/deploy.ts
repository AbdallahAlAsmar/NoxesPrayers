import { REST, Routes } from "discord.js";
import { env } from "../config/env.js";
import { onboardingCommands } from "../modules/onboarding/commands.js";
import { prayerCommand } from "../modules/prayer-times/commands.js";
import { remindersCommand } from "../modules/notifications/commands.js";
import { deleteDataCommand, leaderboardCommand, privacyCommand, serverCommand } from "../modules/community/commands.js";
import { profileCommand } from "../modules/profile/commands.js";
import { logger } from "../shared/logger.js";

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

try {
  await rest.put(Routes.applicationCommands(env.DISCORD_APPLICATION_ID), {
    body: [...onboardingCommands, prayerCommand, remindersCommand, privacyCommand, serverCommand, deleteDataCommand, leaderboardCommand, profileCommand].map((command) => command.toJSON()),
  });
  logger.info("Registered global onboarding slash commands");
} catch (error) {
  logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Command registration failed");
  process.exitCode = 1;
}
