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
const http = require("http");

/* ================= ENV ================= */
const TOKEN = process.env.DISCORD_TOKEN; // Render env var
if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN missing");
  process.exit(1);
}

const OWNER_ID = "1164912728087986277";
const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID || "1443129460390887454";
const SUPPORT_INVITE = "https://discord.gg/kphZKb3uBP";

/* ================= RENDER PORT (START IMMEDIATELY) =================
   Render Web Services require an open port quickly.
   Discord login can take time, so we open the port FIRST.
*/
const PORT = process.env.PORT || 3000;
http
  .createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running");
  })
  .listen(PORT, () => {
    console.log(`🌐 HTTP server listening on port ${PORT}`);
  });

/* ================= Persistence files ================= */
const SETTINGS_FILE = path.join(__dirname, "guildSettings.json");
const SUPPORTERS_FILE = path.join(__dirname, "supporters.json");

/* ================= Defaults ================= */
function defaultGuildSettings() {
  return {
    enabled: true,
    interval: 10,
    customMessage: "meow 😺",
    messagePool: ["meow 😺"],
    counter: 0,
  };
}
const BASE_SLOTS = 5;

/* ================= Stores ================= */
const settingsByGuild = new Map(); // guildId -> settings
let supportersByGuild = {}; // guildId -> { userId: true, ... }

/* ================= Load/Save helpers ================= */
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

/* ================= Slots ================= */
function getBonusSlots(guildId) {
  const supporters = supportersByGuild[guildId];
  if (!supporters) return 0;
  return Object.keys(supporters).length;
}
function getMaxSlotsForGuild(guildId) {
  return BASE_SLOTS + getBonusSlots(guildId);
}

/* ================= Permission check ================= */
function isStaff(interaction) {
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  return (
    perms.has(PermissionFlagsBits.ManageGuild) ||
    perms.has(PermissionFlagsBits.Administrator)
  );
}

/* ================= Helpers ================= */
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
  } catch {}

  // Fallback: first text-based channel where bot can send
  const channels = await guild.channels.fetch();
  const me = guild.members.me;
  const candidates = channels
    .filter((ch) => ch && ch.isTextBased())
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

  for (const ch of candidates.values()) {
    try {
      const perms = me ? ch.permissionsFor(me) : null;
      if (
        perms?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ])
      )
        return ch;
    } catch {}
  }
  return null;
}

async function sendWelcomeMessage(guild) {
  const msg =
    `👋 meow! Thanks for inviting me 😺\n` +
    `• /interval — set interval\n` +
    `• /pooladd — add pool msg\n` +
    `• /poollist — list pool\n` +
    `• Base slots: ${BASE_SLOTS} (+ supporters)\n` +
    `Support: ${SUPPORT_INVITE}`;

  try {
    const ch = await findSpeakableChannel(guild);
    if (ch) await ch.send(msg);
  } catch (e) {
    console.error("Welcome message failed:", e);
  }
}

/* ================= Discord client ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* ================= Slash commands (SHORT descriptions) ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("interval")
    .setDescription("Set interval")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Message count")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("enable")
    .setDescription("Enable auto"),

  new SlashCommandBuilder()
    .setName("disable")
    .setDescription("Disable auto"),

  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Set fallback")
    .addStringOption((opt) =>
      opt.setName("text").setDescription("New text").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pooladd")
    .setDescription("Add to pool")
    .addStringOption((opt) =>
      opt.setName("text").setDescription("Message").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("poolremove")
    .setDescription("Remove from pool")
    .addIntegerOption((opt) =>
      opt.setName("index").setDescription("Number").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("poollist")
    .setDescription("List pool"),

  new SlashCommandBuilder()
    .setName("poolclear")
    .setDescription("Clear pool"),

  new SlashCommandBuilder()
    .setName("supportadd")
    .setDescription("Add support")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("supportremove")
    .setDescription("Remove support")
    .setDMPermission(false),
].map((c) => c.toJSON());

/* ================= Register commands + ready ================= */
client.once("ready", async () => {
  loadAll();

  console.log(`🤖 Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    // Global commands (can take time to appear)
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Slash commands registered (global).");
  } catch (err) {
    console.error("❌ Command registration error:", err);
  }
});

/* ================= When bot joins guild ================= */
client.on("guildCreate", async (guild) => {
  getGuildSettings(guild.id);
  await sendWelcomeMessage(guild);
});

/* ================= Message auto counter ================= */
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // Owner broadcast
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
          await new Promise((r) => setTimeout(r, 1800));
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return msg.reply(`✅ Broadcast done. Sent: **${sent}**, failed: **${failed}**`);
  }

  if (!msg.guild) return;

  const s = getGuildSettings(msg.guild.id);
  if (!s.enabled) return;

  s.counter++;

  if (s.counter >= s.interval) {
    // atomic reset to avoid duplicates on fast message bursts
    s.counter = 0;
    saveAllSoon();

    // optional permission safety
    const canSend = msg.channel
      .permissionsFor(msg.guild.members.me)
      ?.has(PermissionFlagsBits.SendMessages);
    if (!canSend) return;

    const toSend =
      s.messagePool.length > 0 ? pickRandom(s.messagePool) : s.customMessage;

    await msg.channel.send(toSend);
  }
});

/* ================= Slash handler ================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    return interaction.reply({
      content: "Use commands in a server.",
      ephemeral: true,
    });
  }

  const guildId = interaction.guildId;
  const s = getGuildSettings(guildId);
  const name = interaction.commandName;

  // Staff-only commands: reply fast and ephemeral if blocked (no defer needed)
  const staffOnly = new Set([
    "interval",
    "enable",
    "disable",
    "edit",
    "pooladd",
    "poolremove",
    "poolclear",
  ]);
  if (staffOnly.has(name) && !isStaff(interaction)) {
    return interaction.reply({
      content: "❌ Staff only.",
      ephemeral: true,
    });
  }

  // Defer for safety (avoids “application didn’t respond”)
  await interaction.deferReply();

  try {
    if (name === "interval") {
      const amount = interaction.options.getInteger("amount");
      s.interval = Math.max(1, amount);
      s.counter = 0;
      saveAllSoon();
      return interaction.editReply(`✔ Interval set to **${s.interval}**.`);
    }

    if (name === "enable") {
      s.enabled = true;
      saveAllSoon();
      return interaction.editReply("✔ Enabled.");
    }

    if (name === "disable") {
      s.enabled = false;
      saveAllSoon();
      return interaction.editReply("✔ Disabled.");
    }

    if (name === "edit") {
      const text = interaction.options.getString("text");
      s.customMessage = text;
      saveAllSoon();
      return interaction.editReply("✔ Fallback updated.");
    }

    if (name === "pooladd") {
      const text = interaction.options.getString("text");
      const maxSlots = getMaxSlotsForGuild(guildId);

      if (s.messagePool.length >= maxSlots) {
        return interaction.editReply(
          `❌ Pool full (**${maxSlots}**). Join: ${SUPPORT_INVITE}`
        );
      }

      s.messagePool.push(text);
      saveAllSoon();
      return interaction.editReply(
        `✔ Added (**${s.messagePool.length}/${maxSlots}**).`
      );
    }

    if (name === "poolremove") {
      const index = interaction.options.getInteger("index");
      const i = index - 1;

      if (i < 0 || i >= s.messagePool.length) {
        return interaction.editReply("❌ Bad index. Use /poollist.");
      }

      const removed = s.messagePool.splice(i, 1)[0];
      saveAllSoon();
      return interaction.editReply(`🗑 Removed: **${removed}**`);
    }

    if (name === "poolclear") {
      s.messagePool = [];
      saveAllSoon();
      return interaction.editReply("🧹 Pool cleared.");
    }

    if (name === "poollist") {
      const maxSlots = getMaxSlotsForGuild(guildId);
      const bonus = getBonusSlots(guildId);

      const header =
        `📦 Pool: **${s.messagePool.length}/${maxSlots}** (base ${BASE_SLOTS} + bonus ${bonus})\n` +
        `Auto: **${s.enabled ? "on" : "off"}**, Interval: **${s.interval}**\n`;

      if (s.messagePool.length === 0) {
        return interaction.editReply(`${header}\nFallback: **${s.customMessage}**`);
      }

      const lines = s.messagePool.slice(0, 50).map((m, idx) => `${idx + 1}. ${m}`);
      const extra = s.messagePool.length > 50 ? `\n…and ${s.messagePool.length - 50} more.` : "";
      return interaction.editReply(`${header}\n${lines.join("\n")}${extra}`);
    }

    if (name === "supportadd") {
      try {
        const supportGuild = await client.guilds.fetch(SUPPORT_GUILD_ID);
        await supportGuild.members.fetch(interaction.user.id); // throws if not member

        supportersByGuild[guildId] = supportersByGuild[guildId] || {};
        supportersByGuild[guildId][interaction.user.id] = true;
        saveAllSoon();

        const maxSlots = getMaxSlotsForGuild(guildId);
        return interaction.editReply(`✅ Support added. Max slots: **${maxSlots}**`);
      } catch {
        // Can't be ephemeral now because we already deferred non-ephemeral.
        // Keep it normal, but clear message.
        return interaction.editReply(`❌ Join support server first: ${SUPPORT_INVITE}`);
      }
    }

    if (name === "supportremove") {
      if (supportersByGuild[guildId]?.[interaction.user.id]) {
        delete supportersByGuild[guildId][interaction.user.id];
        if (Object.keys(supportersByGuild[guildId]).length === 0) {
          delete supportersByGuild[guildId];
        }
        saveAllSoon();
      }
      const maxSlots = getMaxSlotsForGuild(guildId);
      return interaction.editReply(`✅ Support removed. Max slots: **${maxSlots}**`);
    }

    return interaction.editReply("Unknown command.");
  } catch (err) {
    console.error("Interaction error:", err);
    return interaction.editReply("❌ Error running command.");
  }
});

/* ================= Crash visibility ================= */
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

/* ================= Login ================= */
client.login(TOKEN).catch((err) => {
  console.error("❌ Discord login failed:", err);
  process.exit(1);
});
