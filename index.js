const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const TOKEN = process.env.BOT_TOKEN;

// ---- Bot State ----
let enabled = true;
let interval = 10;

// single message (fallback)
let customMessage = "meow 😺";

// list of random messages
let messagePool = ["meow 😺"]; // start with one
let counter = 0;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Create Client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ---- Slash Commands ----
const commands = [
  new SlashCommandBuilder()
    .setName("interval")
    .setDescription("Set how many messages until bot responds.")
    .addIntegerOption(opt =>
      opt.setName("amount")
        .setDescription("Number of messages")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("enable")
    .setDescription("Enable auto-meow mode"),

  new SlashCommandBuilder()
    .setName("disable")
    .setDescription("Disable auto-meow mode"),

  // keeps your old edit as "fallback message"
  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Change the fallback auto message (used if pool is empty)")
    .addStringOption(opt =>
      opt.setName("text")
        .setDescription("The message to send")
        .setRequired(true)
    ),

  // NEW: add a message to the random pool
  new SlashCommandBuilder()
    .setName("pooladd")
    .setDescription("Add a message to the random pool")
    .addStringOption(opt =>
      opt.setName("text")
        .setDescription("Message to add")
        .setRequired(true)
    ),

  // NEW: remove by index (from /poollist)
  new SlashCommandBuilder()
    .setName("poolremove")
    .setDescription("Remove a message from the pool by its number (see /poollist)")
    .addIntegerOption(opt =>
      opt.setName("index")
        .setDescription("Message number to remove (1, 2, 3...)")
        .setRequired(true)
    ),

  // NEW: list messages
  new SlashCommandBuilder()
    .setName("poollist")
    .setDescription("Show the current random message pool"),

  // NEW: clear messages
  new SlashCommandBuilder()
    .setName("poolclear")
    .setDescription("Clear the random message pool")

].map(cmd => cmd.toJSON());

// ---- Register slash commands ----
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log("Slash commands registered.");
  } catch (err) {
    console.error(err);
  }

  console.log(`Logged in as ${client.user.tag}`);
});

// ---- Message Counter ----
client.on("messageCreate", (msg) => {
  if (msg.author.bot) return;
  if (!enabled) return;

  counter++;

  if (counter >= interval) {
    const toSend = (messagePool.length > 0) ? pickRandom(messagePool) : customMessage;
    msg.channel.send(toSend);
    counter = 0;
  }
});

// ---- Slash Command Handler ----
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const name = interaction.commandName;

  if (name === "interval") {
    const amount = interaction.options.getInteger("amount");
    interval = Math.max(1, amount);
    return interaction.reply(`✔ Interval set to **${interval}** messages.`);
  }

  if (name === "enable") {
    enabled = true;
    return interaction.reply("✔ Auto-meow **ENABLED** 😺");
  }

  if (name === "disable") {
    enabled = false;
    return interaction.reply("❌ Auto-meow **DISABLED**");
  }

  if (name === "edit") {
    const text = interaction.options.getString("text");
    customMessage = text;
    return interaction.reply(`✔ Fallback message updated:\n**${customMessage}**`);
  }

  if (name === "pooladd") {
    const text = interaction.options.getString("text");
    messagePool.push(text);
    return interaction.reply(`✔ Added to pool (#${messagePool.length}):\n**${text}**`);
  }

  if (name === "poolremove") {
    const index = interaction.options.getInteger("index"); // 1-based
    const i = index - 1;

    if (i < 0 || i >= messagePool.length) {
      return interaction.reply({ content: `❌ Invalid index. Use **/poollist** to see numbers.`, ephemeral: true });
    }

    const removed = messagePool.splice(i, 1)[0];
    return interaction.reply(`🗑 Removed from pool (#${index}):\n**${removed}**`);
  }

  if (name === "poollist") {
    if (messagePool.length === 0) {
      return interaction.reply(`(Pool is empty) Fallback is:\n**${customMessage}**`);
    }

    // keep it under Discord message limits
    const lines = messagePool.slice(0, 50).map((m, idx) => `${idx + 1}. ${m}`);
    const extra = messagePool.length > 50 ? `\n…and ${messagePool.length - 50} more.` : "";

    return interaction.reply(`📦 **Message Pool (${messagePool.length})**\n${lines.join("\n")}${extra}`);
  }

  if (name === "poolclear") {
    messagePool = [];
    return interaction.reply("🧹 Pool cleared. Bot will use the fallback message unless you add new ones.");
  }
});

client.login(TOKEN);
