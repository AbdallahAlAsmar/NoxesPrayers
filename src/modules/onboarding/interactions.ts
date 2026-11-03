import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import { GeocodingError, searchPlaces, type GeocodedPlace } from "./geocoding.js";
import { getExistingProfile, saveConfirmedProfile, saveTimeFormat, type PendingProfile, type PreferredTimeFormat } from "./profile.js";
import {
  estimateTimezonesFromLocalClock,
  formatUtcClock,
  formatUtcOffset,
  normalizeIanaTimezone,
  parseLocalClock,
} from "./timezone.js";

const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const PAGE_SIZE = 25;
const sessions = new Map<string, SetupSession>();

interface SetupChoice {
  label: string;
  description: string;
  profile: PendingProfile;
  method: "clock" | "location" | "manual";
}

interface SetupSession {
  id: string;
  ownerId: string;
  choices: SetupChoice[];
  page: number;
  selectedIndex: number | null;
  expiresAt: number;
  note: string;
}

function clearExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function storeSession(ownerId: string, choices: SetupChoice[], note: string): SetupSession {
  clearExpiredSessions();
  const session: SetupSession = {
    id: randomUUID(), ownerId, choices, page: 0, selectedIndex: null,
    expiresAt: Date.now() + SESSION_LIFETIME_MS, note,
  };
  sessions.set(session.id, session);
  return session;
}

function sessionFor(customId: string): SetupSession | null {
  const id = customId.split(":").at(-1);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(id);
    return null;
  }
  return session;
}

function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0xB54747).setTitle("Setup not completed").setDescription(description);
}

function profileForTimezone(timezone: string, existing: PendingProfile | null): PendingProfile {
  return {
    timezone,
    city: existing?.city ?? null,
    countryCode: existing?.countryCode ?? null,
    latitude: existing?.latitude ?? null,
    longitude: existing?.longitude ?? null,
  };
}

function modalOwnerId(customId: string): string | undefined {
  return customId.split(":").at(-1);
}

function choiceRows(session: SetupSession): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const pageCount = Math.ceil(session.choices.length / PAGE_SIZE);
  const start = session.page * PAGE_SIZE;
  const pageChoices = session.choices.slice(start, start + PAGE_SIZE);
  const selectRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`onboard:choice:${session.id}`)
      .setPlaceholder("Choose a timezone or location")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(pageChoices.map((choice, index) => ({
        label: choice.label.slice(0, 100),
        description: choice.description.slice(0, 100),
        value: String(start + index),
      }))),
  );

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [selectRow];
  if (pageCount > 1) {
    const pageButtons = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    if (session.page > 0) {
      pageButtons.addComponents(new ButtonBuilder()
        .setCustomId(`onboard:previous:${session.id}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary));
    }
    if (session.page < pageCount - 1) {
      pageButtons.addComponents(new ButtonBuilder()
        .setCustomId(`onboard:next:${session.id}`)
        .setLabel("More timezones")
        .setStyle(ButtonStyle.Secondary));
    }
    rows.push(pageButtons);
  }
  return rows;
}

function choiceEmbed(session: SetupSession): EmbedBuilder {
  const pageCount = Math.max(1, Math.ceil(session.choices.length / PAGE_SIZE));
  return new EmbedBuilder()
    .setColor(0x287A69)
    .setTitle("Choose your timezone")
    .setDescription(`${session.note}\n\nSelect the timezone or location that matches you. You’ll review it before anything is saved.`)
    .setFooter({ text: `Page ${session.page + 1} of ${pageCount}` });
}

function confirmationRows(session: SetupSession): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`onboard:confirm:${session.id}`).setLabel("Confirm and save").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`onboard:cancel:${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

function confirmationEmbed(session: SetupSession): EmbedBuilder {
  const selected = session.selectedIndex === null ? null : session.choices[session.selectedIndex];
  if (!selected) return errorEmbed("That selection has expired. Start setup again.");

  const location = selected.profile.city
    ? `${selected.profile.city}${selected.profile.countryCode ? `, ${selected.profile.countryCode}` : ""}`
    : "Not set";
  const note = selected.method === "clock"
    ? "A clock-time match estimates an offset; it cannot identify your exact location or timezone by itself."
    : selected.method === "location"
      ? "Location match provided by Open-Meteo using GeoNames data. Your city and coordinates are saved only after you confirm."
      : "The IANA timezone was validated. Your existing location is kept if you already saved one.";

  return new EmbedBuilder()
    .setColor(0x287A69)
    .setTitle("Confirm your settings")
    .setDescription(`**Timezone:** \`${selected.profile.timezone}\`\n**Location:** ${location}\n\n${note}\nConfirming updates your private profile and future schedule version.`);
}

function makeModal(customId: string, title: string, fields: TextInputBuilder[]): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  modal.addComponents(fields.map((field) => new ActionRowBuilder<TextInputBuilder>().addComponents(field)));
  return modal;
}

async function showClockModal(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() && !interaction.isChatInputCommand()) return;
  await interaction.showModal(makeModal(`onboard:submit-clock:${interaction.user.id}`, "Estimate your timezone", [
    new TextInputBuilder().setCustomId("local_clock").setLabel("Your current local time")
      .setPlaceholder("Examples: 12:21 AM, 22:10, 00:15").setRequired(true).setMaxLength(8).setStyle(TextInputStyle.Short),
  ]));
}

async function showLocationModal(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() && !interaction.isChatInputCommand()) return;
  await interaction.showModal(makeModal(`onboard:submit-location:${interaction.user.id}`, "Find your city", [
    new TextInputBuilder().setCustomId("city").setLabel("City")
      .setPlaceholder("For example: Amman").setRequired(true).setMaxLength(100).setStyle(TextInputStyle.Short),
    new TextInputBuilder().setCustomId("country").setLabel("Country name or 2-letter code")
      .setPlaceholder("For example: Jordan or JO").setRequired(true).setMaxLength(100).setStyle(TextInputStyle.Short),
  ]));
}

async function showTimezoneModal(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() && !interaction.isChatInputCommand()) return;
  await interaction.showModal(makeModal(`onboard:submit-timezone:${interaction.user.id}`, "Enter an IANA timezone", [
    new TextInputBuilder().setCustomId("timezone").setLabel("IANA timezone")
      .setPlaceholder("For example: Asia/Jerusalem").setRequired(true).setMaxLength(64).setStyle(TextInputStyle.Short),
  ]));
}

export async function handleOnboardingCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName === "timeformat") {
    const requestedFormat = interaction.options.getString("format", true);
    if (requestedFormat !== "H12" && requestedFormat !== "H24") {
      await interaction.reply({ embeds: [errorEmbed("Choose either 12-hour or 24-hour format.")], flags: MessageFlags.Ephemeral });
      return true;
    }
    await saveTimeFormat(interaction.user.id, requestedFormat as PreferredTimeFormat);
    const label = requestedFormat === "H12" ? "12-hour (AM/PM)" : "24-hour";
    await interaction.reply({ content: `Saved your preferred time format: **${label}**.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.commandName === "timezone") {
    await showTimezoneModal(interaction);
    return true;
  }
  if (interaction.commandName === "location") {
    await showLocationModal(interaction);
    return true;
  }
  if (interaction.commandName !== "setup") return false;

  const utcNow = new Date();
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`onboard:clock:${interaction.user.id}`).setLabel("Enter my local time").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`onboard:location:${interaction.user.id}`).setLabel("Choose city and country").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`onboard:manual:${interaction.user.id}`).setLabel("Enter timezone manually").setStyle(ButtonStyle.Secondary),
  );
  const embed = new EmbedBuilder().setColor(0x287A69).setTitle("Set up private prayer reminders")
    .setDescription(`Current UTC time: **${formatUtcClock(utcNow)}**\n\nChoose a setup method. Clock-time matching only suggests possible offsets; it cannot determine a unique timezone or your location. Prayer-time calculations also need coordinates, which you can add by choosing a city. You’ll review and confirm before settings are saved.\n\nCity search sends the city and country you enter to Open-Meteo. Location details are saved only after confirmation.`);
  await interaction.reply({ embeds: [embed], components: [buttons], flags: MessageFlags.Ephemeral });
  return true;
}

async function replyWithChoices(ownerId: string, choices: SetupChoice[], note: string, interaction: Interaction): Promise<void> {
  const session = storeSession(ownerId, choices, note);
  const payload = { embeds: [choiceEmbed(session)], components: choiceRows(session) };
  if (interaction.isModalSubmit()) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  else if (interaction.isStringSelectMenu() || interaction.isButton()) await interaction.update(payload);
}

async function handleClockSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const submittedAt = new Date();
  const parsed = parseLocalClock(interaction.fields.getTextInputValue("local_clock"));
  if (!parsed.ok) {
    const message = parsed.reason === "ambiguous"
      ? "A one-digit hour from 1 to 12 needs AM or PM. Use a 24-hour time such as `05:33` or include AM/PM, such as `5:33 PM`."
      : "Enter a valid time such as `12:21 AM`, `22:10`, `17:33`, or `00:15`.";
    await interaction.reply({ embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral });
    return;
  }

  const candidates = estimateTimezonesFromLocalClock(parsed.minuteOfDay, submittedAt);
  if (candidates.length === 0) {
    await interaction.reply({ embeds: [errorEmbed("That clock time did not match a current IANA timezone offset. Use `/timezone` to enter a timezone directly.")], flags: MessageFlags.Ephemeral });
    return;
  }

  const existing = await getExistingProfile(interaction.user.id);
  const choices: SetupChoice[] = candidates.map(({ timeZone, offsetMinutes }) => ({
    label: timeZone,
    description: `${formatUtcOffset(offsetMinutes)} · IANA timezone`,
    profile: profileForTimezone(timeZone, existing),
    method: "clock",
  }));
  const offsets = [...new Set(candidates.map((candidate) => candidate.offsetMinutes))].map(formatUtcOffset).join(", ");
  await replyWithChoices(
    interaction.user.id,
    choices,
    `At **${formatUtcClock(submittedAt)}**, your entered time is consistent with: **${offsets}**. Many timezones share offsets and can differ during daylight saving changes. The estimate uses the UTC timestamp when you submitted this form.`,
    interaction,
  );
}

async function handleLocationSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  let places: GeocodedPlace[];
  try {
    places = await searchPlaces(interaction.fields.getTextInputValue("city"), interaction.fields.getTextInputValue("country"), interaction.user.id);
  } catch (error) {
    const message = error instanceof GeocodingError ? error.message : "Location search failed. Try again or enter an IANA timezone manually.";
    await interaction.reply({ embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral });
    return;
  }

  const choices: SetupChoice[] = places.map((place) => ({
    label: place.admin1 ? `${place.name}, ${place.admin1}` : place.name,
    description: `${place.country ?? place.countryCode ?? "Country unavailable"} · ${place.timezone}`,
    profile: {
      timezone: place.timezone,
      city: place.name,
      countryCode: place.countryCode,
      latitude: place.latitude,
      longitude: place.longitude,
    },
    method: "location",
  }));
  await replyWithChoices(interaction.user.id, choices, "Select the matching city. Coordinates and timezone come from Open-Meteo’s GeoNames-based location search.", interaction);
}

async function handleManualTimezoneSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const timezone = normalizeIanaTimezone(interaction.fields.getTextInputValue("timezone"));
  if (!timezone) {
    await interaction.reply({ embeds: [errorEmbed("That is not a recognized IANA timezone. Use a name such as `Asia/Jerusalem` or `America/Toronto`.")], flags: MessageFlags.Ephemeral });
    return;
  }

  const existing = await getExistingProfile(interaction.user.id);
  const session = storeSession(interaction.user.id, [{
    label: timezone,
    description: "Manually entered IANA timezone",
    profile: profileForTimezone(timezone, existing),
    method: "manual",
  }], "Review the timezone below before saving.");
  session.selectedIndex = 0;
  await interaction.reply({ embeds: [confirmationEmbed(session)], components: [confirmationRows(session)], flags: MessageFlags.Ephemeral });
}

async function handleComponent(interaction: Interaction): Promise<boolean> {
  if (interaction.isButton()) {
    const initialAction = interaction.customId.split(":");
    if (initialAction[0] === "onboard" && ["clock", "location", "manual"].includes(initialAction[1] ?? "")
      && initialAction[2] !== interaction.user.id) {
      await interaction.reply({ embeds: [errorEmbed("This setup belongs to another Discord user.")], flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.customId.startsWith("onboard:clock:")) {
      await showClockModal(interaction);
      return true;
    }
    if (interaction.customId.startsWith("onboard:location:")) {
      await showLocationModal(interaction);
      return true;
    }
    if (interaction.customId.startsWith("onboard:manual:")) {
      await showTimezoneModal(interaction);
      return true;
    }

    if (!interaction.customId.startsWith("onboard:")) return false;
    const session = sessionFor(interaction.customId);
    if (!session) {
      await interaction.reply({ embeds: [errorEmbed("This setup session expired. Run `/setup` to start again.")], flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.user.id !== session.ownerId) {
      await interaction.reply({ embeds: [errorEmbed("This setup belongs to another Discord user.")], flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.customId.startsWith("onboard:previous:")) {
      session.page = Math.max(0, session.page - 1);
      await interaction.update({ embeds: [choiceEmbed(session)], components: choiceRows(session) });
      return true;
    }
    if (interaction.customId.startsWith("onboard:next:")) {
      const lastPage = Math.max(0, Math.ceil(session.choices.length / PAGE_SIZE) - 1);
      session.page = Math.min(lastPage, session.page + 1);
      await interaction.update({ embeds: [choiceEmbed(session)], components: choiceRows(session) });
      return true;
    }
    if (interaction.customId.startsWith("onboard:cancel:")) {
      sessions.delete(session.id);
      await interaction.update({ content: "Setup cancelled. No changes were saved.", embeds: [], components: [] });
      return true;
    }
    if (interaction.customId.startsWith("onboard:confirm:")) {
      const selected = session.selectedIndex === null ? null : session.choices[session.selectedIndex];
      if (!selected) {
        await interaction.reply({ embeds: [errorEmbed("Select a timezone or location first.")], flags: MessageFlags.Ephemeral });
        return true;
      }
      await saveConfirmedProfile(session.ownerId, selected.profile);
      sessions.delete(session.id);
      const locationStatus = selected.profile.latitude === null || selected.profile.longitude === null
        ? " Run `/location` to add coordinates before prayer times can be calculated."
        : "";
      await interaction.update({ content: `Saved **${selected.profile.timezone}** to your private profile.${locationStatus}`, embeds: [], components: [] });
      return true;
    }
    return false;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("onboard:choice:")) {
    const session = sessionFor(interaction.customId);
    if (!session) {
      await interaction.reply({ embeds: [errorEmbed("This setup session expired. Run `/setup` to start again.")], flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.user.id !== session.ownerId) {
      await interaction.reply({ embeds: [errorEmbed("This setup belongs to another Discord user.")], flags: MessageFlags.Ephemeral });
      return true;
    }
    const selectedIndex = Number(interaction.values[0]);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= session.choices.length) {
      await interaction.reply({ embeds: [errorEmbed("That selection is no longer available. Start setup again.")], flags: MessageFlags.Ephemeral });
      return true;
    }
    session.selectedIndex = selectedIndex;
    await interaction.update({ embeds: [confirmationEmbed(session)], components: [confirmationRows(session)] });
    return true;
  }

  return false;
}

export async function handleOnboardingInteraction(interaction: Interaction): Promise<boolean> {
  if (interaction.isButton() || interaction.isStringSelectMenu()) return handleComponent(interaction);
  if (!interaction.isModalSubmit()) return false;
  if (modalOwnerId(interaction.customId) !== interaction.user.id) {
    await interaction.reply({ embeds: [errorEmbed("This setup form belongs to another Discord user.")], flags: MessageFlags.Ephemeral });
    return true;
  }

  switch (interaction.customId.split(":")[1]) {
    case "submit-clock":
      await handleClockSubmit(interaction);
      return true;
    case "submit-location":
      await handleLocationSubmit(interaction);
      return true;
    case "submit-timezone":
      await handleManualTimezoneSubmit(interaction);
      return true;
    default:
      return false;
  }
}
