const { readdirSync } = require("fs");
const AsciiTable = require("ascii-table");

const table = new AsciiTable("Commands");
table.setHeading("File", "Status");

/**
 * Loads all command files from the ./commands directory into client.commands.
 * Each subdirectory is treated as a category. Files must export { name, run }.
 */
module.exports = (client) => {
  const categories = readdirSync("./commands/");

  for (const dir of categories) {
    const files = readdirSync(`./commands/${dir}/`).filter((f) => f.endsWith(".js"));

    for (const file of files) {
      const command = require(`../commands/${dir}/${file}`);

      if (command.name) {
        client.commands.set(command.name, command);
        table.addRow(file, "✅ Loaded");
      } else {
        table.addRow(file, "❌ Missing name export");
      }

      if (command.aliases && Array.isArray(command.aliases)) {
        command.aliases.forEach((alias) => client.aliases.set(alias, command.name));
      }
    }
  }

  console.log(table.toString());
};