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
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN missing");
  process.exit(1);
}

const OWNER_ID = "1164912728087986277";
const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID || "1443129460390887454";
const SUPPORT_INVITE = "https://discord.gg/kphZKb3uBP";

/* ================= FILES ================= */
const SETTINGS_FILE = path.join(__dirname, "guildSettings.json");
const SUPPORTERS_FILE = path.join(__dirname, "supporters.json");

/* ================= DEFAULTS ================= */
const BASE_SLOTS = 5;

function defaultGuildSettings() {
  return {
    enabled: true,
    interval: 10,
    customMessage: "meow 😺",
    messagePool: ["meow 😺"],
    counter: 0,
  };
}

/* ================= STORES ================= */
const settingsByGuild = new Map();
let supportersByGuild = {};

/* ================= FS HELPERS ================= */
function safeReadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function safeWriteJSON(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch {}
}

function loadAll() {
  const raw = safeReadJSON(SETTINGS_FILE, {});
  for (const [g, d] of Object.entries(raw)) {
    settingsByGuild.set(g, { ...defaultGuildSettings(), ...d });
  }
  supportersByGuild = safeReadJSON(SUPPORTERS_FILE, {});
}

let saveTimer;
function saveAllSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    safeWriteJSON(SETTINGS_FILE, Object.fromEntries(settingsByGuild));
    safeWriteJSON(SUPPORTERS_FILE, supportersByGuild);
  }, 300);
}

function getGuildSettings(id) {
  if (!settingsByGuild.has(id)) {
    settingsByGuild.set(id, defaultGuildSettings());
    saveAllSoon();
  }
  return settingsByGuild.get(id);
}

/* ================= SLOTS ================= */
const getBonusSlots = id =>
  supportersByGuild[id] ? Object.keys(supportersByGuild[id]).length : 0;
const getMaxSlotsForGuild = id => BASE_SLOTS + getBonusSlots(id);

/* ================= PERMS ================= */
const isStaff = i =>
  i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
  i.memberPermissions?.has(PermissionFlagsBits.Administrator);

/* ================= HELPERS ================= */
const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* ================= SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("interval")
    .setDescription("Set reply interval")
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Messages count").setRequired(true)
    ),

  new SlashCommandBuilder().setName("enable").setDescription("Enable auto replies"),
  new SlashCommandBuilder().setName("disable").setDescription("Disable auto replies"),

  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Edit fallback message")
    .addStringOption(o =>
      o.setName("text").setDescription("New message").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pooladd")
    .setDescription("Add pool message")
    .addStringOption(o =>
      o.setName("text").setDescription("Message text").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("poolremove")
    .setDescription("Remove pool message")
    .addIntegerOption(o =>
      o.setName("index").setDescription("Message number").setRequired(true)
    ),

  new SlashCommandBuilder().setName("poollist").setDescription("Show message pool"),
  new SlashCommandBuilder().setName("poolclear").setDescription("Clear message pool"),

  new SlashCommandBuilder().setName("supportadd").setDescription("Add support slot"),
  new SlashCommandBuilder().setName("supportremove").setDescription("Remove support slot"),
].map(c => c.toJSON());

/* ================= READY ================= */
client.once("ready", async () => {
  loadAll();
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

/* ================= MESSAGE HANDLER ================= */
client.on("messageCreate", async msg => {
  if (!msg.guild || msg.author.bot) return;

  if (
    msg.author.id === OWNER_ID &&
    msg.content.startsWith("..meowbot globalmessage ")
  ) {
    const text = msg.content.slice(26).trim();
    for (const g of client.guilds.cache.values()) {
      try {
        const ch = g.systemChannel;
        if (ch) await ch.send(text);
        await new Promise(r => setTimeout(r, 1800));
      } catch {}
    }
    return msg.reply("✅ Broadcast sent");
  }

  const s = getGuildSettings(msg.guild.id);
  if (!s.enabled) return;

  s.counter++;
  if (s.counter >= s.interval) {
    s.counter = 0;
    saveAllSoon();
    await msg.channel.send(
      s.messagePool.length ? pickRandom(s.messagePool) : s.customMessage
    );
  }
});

/* ================= INTERACTIONS (FIXED) ================= */
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand() || !i.guildId) return;

  await i.deferReply(); // ✅ REQUIRED

  const s = getGuildSettings(i.guildId);
  const name = i.commandName;

  const staffOnly = new Set([
    "interval",
    "enable",
    "disable",
    "edit",
    "pooladd",
    "poolremove",
    "poolclear",
  ]);

  if (staffOnly.has(name) && !isStaff(i)) {
    return i.editReply({ content: "Staff only", ephemeral: true });
  }

  if (name === "interval") {
    s.interval = Math.max(1, i.options.getInteger("amount"));
    s.counter = 0;
    saveAllSoon();
    return i.editReply(`Interval set to ${s.interval}`);
  }

  if (name === "enable") {
    s.enabled = true;
    saveAllSoon();
    return i.editReply("Enabled");
  }

  if (name === "disable") {
    s.enabled = false;
    saveAllSoon();
    return i.editReply("Disabled");
  }

  if (name === "edit") {
    s.customMessage = i.options.getString("text");
    saveAllSoon();
    return i.editReply("Updated");
  }

  if (name === "pooladd") {
    const max = getMaxSlotsForGuild(i.guildId);
    if (s.messagePool.length >= max) {
      return i.editReply(`Pool full (${max}) ${SUPPORT_INVITE}`);
    }
    s.messagePool.push(i.options.getString("text"));
    saveAllSoon();
    return i.editReply("Added");
  }

  if (name === "poolremove") {
    const idx = i.options.getInteger("index") - 1;
    if (idx < 0 || idx >= s.messagePool.length) {
      return i.editReply("Invalid index");
    }
    s.messagePool.splice(idx, 1);
    saveAllSoon();
    return i.editReply("Removed");
  }

  if (name === "poolclear") {
    s.messagePool = [];
    saveAllSoon();
    return i.editReply("Cleared");
  }

  if (name === "poollist") {
    return i.editReply(
      s.messagePool.length
        ? s.messagePool.map((m, i) => `${i + 1}. ${m}`).join("\n")
        : `Fallback: ${s.customMessage}`
    );
  }

  if (name === "supportadd") {
    try {
      const g = await client.guilds.fetch(SUPPORT_GUILD_ID);
      await g.members.fetch(i.user.id);
      supportersByGuild[i.guildId] ??= {};
      supportersByGuild[i.guildId][i.user.id] = true;
      saveAllSoon();
      return i.editReply("Support added");
    } catch {
      return i.editReply({
        content: `Join first: ${SUPPORT_INVITE}`,
        ephemeral: true,
      });
    }
  }

  if (name === "supportremove") {
    delete supportersByGuild[i.guildId]?.[i.user.id];
    saveAllSoon();
    return i.editReply("Support removed");
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= DUMMY HTTP SERVER (RENDER FREE) ================= */
const PORT = process.env.PORT || 3000;
http.createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});
