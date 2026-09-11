import { Command } from "commander";
import { evalAccent, evalEditor, evalGolden } from "./commands/evals";
import { importCsv, reviewCommand, runListing } from "./commands/listings";
import { smoke } from "./commands/smoke";
import { spike } from "./commands/spike";

const program = new Command();
program.name("pt-pipeline").description("Imóvel em Voz: pt-PT property copy and voice-over pipeline").version("0.1.0");

program
  .command("smoke")
  .description("Run the fixture listing end to end with the providers in .env (fake by default)")
  .option("--out <dir>", "output directory", "./out/smoke")
  .option("-q, --quiet", "silence logs")
  .action(async (o) => process.exit(await smoke({ out: o.out, quiet: Boolean(o.quiet) })));

program
  .command("import-csv <path>")
  .description("Import an agency CSV feed as owned listings")
  .option("--no-run", "import only, do not run jobs")
  .action(async (path, o) => process.exit(await importCsv(path, { run: o.run !== false })));

program
  .command("run <listingId>")
  .description("Run the full pipeline for a stored listing")
  .action(async (id) => process.exit(await runListing(id)));

const review = program.command("review").description("Human review queue");
review.command("list").action(async () => process.exit(await reviewCommand("list")));
review
  .command("approve <id>")
  .option("--file <sections.json>", "edited sections")
  .action(async (id, o) => process.exit(await reviewCommand("approve", id, o.file)));
review.command("reject <id>").action(async (id) => process.exit(await reviewCommand("reject", id)));

const evalCmd = program.command("eval").description("Regression evals");
evalCmd.command("golden").option("--dir <dir>").option("--report <file>").action(async (o) => process.exit(await evalGolden(o)));
evalCmd.command("editor").option("--file <cases.json>").action(async (o) => process.exit(await evalEditor(o)));
evalCmd.command("accent").option("--file <sentences.json>").action(async (o) => process.exit(await evalAccent(o)));

program
  .command("spike <kind>")
  .description("Phase 0 spikes: tts | amalia | sources")
  .option("--query <urlOrLocation>", "search url or location for the sources spike")
  .action(async (kind, o) => process.exit(await spike(kind, o)));

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
