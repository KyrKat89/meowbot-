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

/* ================= START HTTP SERVER IMMEDIATELY (RENDER NEEDS THIS) ================= */
const PORT = process.env.PORT || 3000;
http.createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

/* ================= CONSTANTS ================= */
const OWNER_ID = "1164912728087986277";
const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID || "1443129460390887454";
const SUPPORT_INVITE = "https://discord.gg/kphZKb3uBP";

const SETTINGS_FILE = path.join(__dirname, "guildSettings.json");
const SUPPORTERS_FILE = path.join(__dirname, "supporters.json");
const BASE_SLOTS = 5;

/* ================= DEFAULTS ================= */
function defaultGuildSettings() {
  return {
    enabled: true,
    interval: 10,
    customMessage: "meow 😺",
    messagePool: ["meow 😺"],
    counter: 0,
  };
}

/* ================= STORAGE ================= */
const settingsByGuild = new Map();
let supportersByGuild = {};

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

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  loadAll();

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: [] } // commands already registered earlier
  );
});

/* ================= LOGIN ================= */
client.login(TOKEN).catch(err => {
  console.error("❌ Discord login failed:", err);
  process.exit(1);
});
