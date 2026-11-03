import { InteractionContextType, SlashCommandBuilder } from "discord.js";

export const profileCommand = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("View your private prayer profile and reminder overview")
  .setContexts(InteractionContextType.Guild);
