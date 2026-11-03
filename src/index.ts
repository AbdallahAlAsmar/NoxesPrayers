import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from "discord.js";
import { createServer } from "node:http";
import { env } from "./config/env.js";
import { prisma } from "./db/client.js";
import { handleOnboardingCommand, handleOnboardingInteraction } from "./modules/onboarding/interactions.js";
import { handlePrayerCommand, handlePrayerInteraction } from "./modules/prayer-times/interactions.js";
import { handleReminderCommand } from "./modules/notifications/interactions.js";
import { startNotificationRuntime } from "./modules/notifications/runtime.js";
import { handleCommunityCommand } from "./modules/community/interactions.js";
import { handleProfileCommand } from "./modules/profile/interactions.js";
import { logger } from "./shared/logger.js";
import { SlidingWindowRateLimiter } from "./shared/rateLimit.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let shuttingDown = false;
let stopNotificationRuntime: (() => Promise<void>) | null = null;
const healthServer = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "alive" }));
    return;
  }
  if (request.url !== "/readyz") {
    response.writeHead(404).end();
    return;
  }
  void (async () => {
    if (!client.isReady()) {
      response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "not_ready" }));
      return;
    }
    try {
      await prisma.$queryRaw`SELECT 1`;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ready" }));
    } catch {
      response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "database_unavailable" }));
    }
  })();
});
const interactionLimiter = new SlidingWindowRateLimiter(6, 10_000);

client.once(Events.ClientReady, (readyClient) => {
  logger.info({ discordUserId: readyClient.user.id }, "Discord client ready");
  stopNotificationRuntime = startNotificationRuntime(readyClient);
});

async function handleInteraction(interaction: Interaction): Promise<void> {
  if ((interaction.isChatInputCommand() || interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
    && !interactionLimiter.allow(interaction.user.id)) {
    if (interaction.isRepliable()) await interaction.reply({ content: "Please wait a few seconds before trying again.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    return;
  }
  try {
    if (interaction.isChatInputCommand()) {
      const handled = await handleOnboardingCommand(interaction);
      if (!handled && !await handlePrayerCommand(interaction) && !await handleReminderCommand(interaction, client)
        && !await handleCommunityCommand(interaction, client)) await handleProfileCommand(interaction);
      return;
    }
    const handled = await handleOnboardingInteraction(interaction);
    if (!handled) await handlePrayerInteraction(interaction);
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Interaction handling failed");
    const reply = { content: "That request could not be completed right now. Please try again shortly.", flags: MessageFlags.Ephemeral as const };
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => undefined);
      else await interaction.reply(reply).catch(() => undefined);
    }
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

client.on(Events.GuildDelete, (guild) => {
  void prisma.guildSettings.deleteMany({ where: { guildId: guild.id } }).catch((error: unknown) => {
    logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Removed server community configuration could not be cleaned up");
  });
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  await stopNotificationRuntime?.();
  client.destroy();
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await prisma.$disconnect();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await new Promise<void>((resolve, reject) => {
    healthServer.once("error", reject);
    healthServer.listen(env.HEALTH_PORT, "0.0.0.0", () => resolve());
  });
  logger.info({ port: env.HEALTH_PORT }, "Health server listening");
  await prisma.$queryRaw`SELECT 1`;
  logger.info("PostgreSQL connection healthy");
  await client.login(env.DISCORD_TOKEN);
} catch (error) {
  logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Startup failed");
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exitCode = 1;
}
