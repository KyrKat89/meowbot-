const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.BOT_TOKEN;

// You (bot owner)
const OWNER_ID = "1164912728087986277";

// Your support server (for opt-in bonus slots)
const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID || "1443129460390887454";

// Invite link you want to show when pool is full
const SUPPORT_INVITE = "https://discord.gg/kphZKb3uBP";

// -------- Persistence files --------
const SETTINGS_FILE = path.join(__dirname, "guildSettings.json");
const SUPPORTERS_FILE = path.join(__dirname, "supporters.json");

// -------- Defaults --------
function defaultGuildSettings() {
  return {
    enabled: true,
    interval: 10,
    customMessage: "meow 😺",      // fallback if pool empty
    messagePool: ["meow 😺"],      // random pool
    counter: 0,                   // per-guild counter
  };
}

// default base slots
const BASE_SLOTS = 5;

// -------- Stores --------
const settingsByGuild = new Map();         // guildId -> settings
let supportersByGuild = {};                // guildId -> { userId: true, ... }  (opt-in)

// -------- Load/Save helpers --------
function safeReadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Failed reading ${file}:`, e);
    return fallback;
  }
}

function safeWriteJSON(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error(`Failed writing ${file}:`, e);
  }
}

function loadAll() {
  const rawSettings = safeReadJSON(SETTINGS_FILE, {});
  for (const [guildId, data] of Object.entries(rawSettings)) {
    settingsByGuild.set(guildId, {
      ...defaultGuildSettings(),
      ...data,
      messagePool: Array.isArray(data.messagePool)
        ? data.messagePool
        : defaultGuildSettings().messagePool,
    });
  }

  supportersByGuild = safeReadJSON(SUPPORTERS_FILE, {});
}

let saveTimer = null;
function saveAllSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const obj = Object.fromEntries(settingsByGuild.entries());
    safeWriteJSON(SETTINGS_FILE, obj);
    safeWriteJSON(SUPPORTERS_FILE, supportersByGuild);
  }, 300);
}

function getGuildSettings(guildId) {
  if (!settingsByGuild.has(guildId)) {
    settingsByGuild.set(guildId, defaultGuildSettings());
    saveAllSoon();
  }
  return settingsByGuild.get(guildId);
}

// -------- Slot calculation (safe opt-in model) --------
function getBonusSlots(guildId) {
  const supporters = supportersByGuild[guildId];
  if (!supporters) return 0;
  return Object.keys(supporters).length;
}

function getMaxSlotsForGuild(guildId) {
  return BASE_SLOTS + getBonusSlots(guildId);
}

// -------- Permission check --------
function isStaff(interaction) {
  // Staff = Manage Guild OR Administrator
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ManageGuild) || perms.has(PermissionFlagsBits.Administrator);
}

// -------- Messaging helpers --------
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function findSpeakableChannel(guild) {
  // Prefer system channel
  try {
    if (guild.systemChannelId) {
      const ch = await guild.channels.fetch(guild.systemChannelId);
      if (ch && ch.isTextBased()) return ch;
    }
  } catch (_) {}

  // Fallback: first text-based channel where bot can send
  const channels = await guild.channels.fetch();
  const me = guild.members.me;
  const candidates = channels
    .filter(ch => ch && ch.isTextBased())
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

  for (const ch of candidates.values()) {
    try {
      const perms = me ? ch.permissionsFor(me) : null;
      if (perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return ch;
    } catch (_) {}
  }
  return null;
}

async function sendWelcomeMessage(guild) {
  const msg =
    `👋 meow! Thanks for inviting me 😺\n` +
    `• Set frequency: **/interval**\n` +
    `• Add random messages: **/pooladd**\n` +
    `• List messages: **/poollist**\n` +
    `• Default pool slots: **${BASE_SLOTS}** (bonus slots via supporters)\n` +
    `Support server: ${SUPPORT_INVITE}`;

  try {
    const ch = await findSpeakableChannel(guild);
    if (ch) await ch.send(msg);
  } catch (e) {
    console.error("Welcome message failed:", e);
  }
}

// -------- Discord client --------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// -------- Slash Commands --------
const commands = [
  new SlashCommandBuilder()
    .setName("interval")
    .setDescription("Set how many messages until bot responds (this server only).")
    .addIntegerOption(opt =>
      opt.setName("amount").setDescription("Number of messages").setRequired(true)
    ),

  new SlashCommandBuilder().setName("enable").setDescription("Enable auto mode (this server only)."),
  new SlashCommandBuilder().setName("disable").setDescription("Disable auto mode (this server only)."),

  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Change the fallback message (this server only).")
    .addStringOption(opt =>
      opt.setName("text").setDescription("The message to send").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pooladd")
    .setDescription("Add a message to the random pool (this server only).")
    .addStringOption(opt =>
      opt.setName("text").setDescription("Message to add").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("poolremove")
    .setDescription("Remove a message from the pool by number (see /poollist).")
    .addIntegerOption(opt =>
      opt.setName("index").setDescription("Message number to remove (1, 2, 3...)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("poollist")
    .setDescription("Show the current random message pool + slots (this server only)."),

  new SlashCommandBuilder()
    .setName("poolclear")
    .setDescription("Clear the random message pool (this server only)."),

  // Opt-in supporters system (safe bonus slots)
  new SlashCommandBuilder()
    .setName("supportadd")
    .setDescription("Support THIS server (+1 slot) if you are also in the support server.")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("supportremove")
    .setDescription("Remove your support from THIS server (-1 slot).")
    .setDMPermission(false),

].map(c => c.toJSON());

// -------- Register commands --------
client.once("ready", async () => {
  loadAll();

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    // Global registration (may take time to appear)
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Global slash commands registered.");
  } catch (err) {
    console.error("❌ Command registration error:", err);
  }

  console.log(`Logged in as ${client.user.tag}`);
});

// -------- When bot joins a new server --------
client.on("guildCreate", async (guild) => {
  getGuildSettings(guild.id);
  await sendWelcomeMessage(guild);
});

// -------- Auto message counter (per server) --------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // Global announcement feature (owner-only)
  if (msg.author.id === OWNER_ID && msg.content.startsWith("..meowbot globalmessage ")) {
    const text = msg.content.slice("..meowbot globalmessage ".length).trim();
    if (!text) return;

    let sent = 0;
    let failed = 0;

    for (const guild of client.guilds.cache.values()) {
      try {
        const ch = await findSpeakableChannel(guild);
        if (ch) {
          await ch.send(text);
          sent++;
          // small delay to reduce rate-limit risk
          await new Promise(r => setTimeout(r, 1200));
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }

    return msg.reply(`✅ Broadcast done. Sent: **${sent}**, failed/no channel: **${failed}**`);
  }

  if (!msg.guild) return;

  const s = getGuildSettings(msg.guild.id);
  if (!s.enabled) return;

  s.counter++;

  if (s.counter >= s.interval) {
    const toSend = s.messagePool.length > 0 ? pickRandom(s.messagePool) : s.customMessage;
    await msg.channel.send(toSend);
    s.counter = 0;
    saveAllSoon();
  }
});

// -------- Slash command handler --------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    return interaction.reply({ content: "Use these commands in a server (not in DMs).", ephemeral: true });
  }

  const guildId = interaction.guildId;
  const s = getGuildSettings(guildId);
  const name = interaction.commandName;

  // Staff-only management commands
  const staffOnly = new Set(["interval", "enable", "disable", "edit", "pooladd", "poolremove", "poolclear"]);
  if (staffOnly.has(name) && !isStaff(interaction)) {
    return interaction.reply({ content: "❌ Only server staff can use this command.", ephemeral: true });
  }

  if (name === "interval") {
    const amount = interaction.options.getInteger("amount");
    s.interval = Math.max(1, amount);
    s.counter = 0;
    saveAllSoon();
    return interaction.reply(`✔ Interval for this server set to **${s.interval}** messages.`);
  }

  if (name === "enable") {
    s.enabled = true;
    saveAllSoon();
    return interaction.reply("✔ Auto mode **ENABLED** for this server 😺");
  }

  if (name === "disable") {
    s.enabled = false;
    saveAllSoon();
    return interaction.reply("❌ Auto mode **DISABLED** for this server");
  }

  if (name === "edit") {
    const text = interaction.options.getString("text");
    s.customMessage = text;
    saveAllSoon();
    return interaction.reply(`✔ Fallback message updated for this server:\n**${s.customMessage}**`);
  }

  if (name === "pooladd") {
    const text = interaction.options.getString("text");

    const maxSlots = getMaxSlotsForGuild(guildId);
    if (s.messagePool.length >= maxSlots) {
      return interaction.reply(
        `❌ This server hit the max pool size (**${maxSlots}**).\n` +
        `Join the support server to unlock more slots: ${SUPPORT_INVITE}`
      );
    }

    s.messagePool.push(text);
    saveAllSoon();
    return interaction.reply(`✔ Added to this server pool (#${s.messagePool.length}/${maxSlots}):\n**${text}**`);
  }

  if (name === "poolremove") {
    const index = interaction.options.getInteger("index");
    const i = index - 1;

    if (i < 0 || i >= s.messagePool.length) {
      return interaction.reply({ content: "❌ Invalid index. Use **/poollist** to see numbers.", ephemeral: true });
    }

    const removed = s.messagePool.splice(i, 1)[0];
    saveAllSoon();
    return interaction.reply(`🗑 Removed from this server pool (#${index}):\n**${removed}**`);
  }

  if (name === "poolclear") {
    s.messagePool = [];
    saveAllSoon();
    return interaction.reply("🧹 Pool cleared for this server. Add new ones with **/pooladd**.");
  }

  if (name === "poollist") {
    const maxSlots = getMaxSlotsForGuild(guildId);
    const bonus = getBonusSlots(guildId);

    const header =
      `📦 **Server Message Pool**\n` +
      `Slots: **${s.messagePool.length}/${maxSlots}** (base ${BASE_SLOTS} + bonus ${bonus})\n` +
      `Enabled: **${s.enabled ? "yes" : "no"}**, Interval: **${s.interval}**`;

    if (s.messagePool.length === 0) {
      return interaction.reply(`${header}\n\n(Pool is empty) Fallback is:\n**${s.customMessage}**`);
    }

    const lines = s.messagePool.slice(0, 50).map((m, idx) => `${idx + 1}. ${m}`);
    const extra = s.messagePool.length > 50 ? `\n…and ${s.messagePool.length - 50} more.` : "";
    return interaction.reply(`${header}\n\n${lines.join("\n")}${extra}`);
  }

  // ---- Supporters (safe opt-in bonus slots) ----
  // A user can only add support if they are in the support server.
  // This avoids cross-server member scraping.
  if (name === "supportadd") {
    try {
      const supportGuild = await client.guilds.fetch(SUPPORT_GUILD_ID);
      await supportGuild.members.fetch(interaction.user.id); // throws if not a member

      supportersByGuild[guildId] = supportersByGuild[guildId] || {};
      supportersByGuild[guildId][interaction.user.id] = true;
      saveAllSoon();

      const maxSlots = getMaxSlotsForGuild(guildId);
      return interaction.reply(`✅ You now support this server. New max slots: **${maxSlots}**`);
    } catch {
      return interaction.reply({
        content: `❌ To support a server, join the support server first: ${SUPPORT_INVITE}`,
        ephemeral: true
      });
    }
  }

  if (name === "supportremove") {
    if (supportersByGuild[guildId]?.[interaction.user.id]) {
      delete supportersByGuild[guildId][interaction.user.id];
      if (Object.keys(supportersByGuild[guildId]).length === 0) delete supportersByGuild[guildId];
      saveAllSoon();
    }
    const maxSlots = getMaxSlotsForGuild(guildId);
    return interaction.reply(`✅ Support removed. New max slots: **${maxSlots}**`);
  }
});

client.login(TOKEN);
