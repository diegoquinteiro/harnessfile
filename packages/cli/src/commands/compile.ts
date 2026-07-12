import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { parseHarnessfile, resolveHarnessfilePath } from "../parser/parse.js";
import { normalize } from "../ir/normalize.js";
import { validateHarnessfile } from "../validator/validate.js";
import { getCompileProvider, listCompileProviders } from "../providers/compile.js";
// Side-effect import: registers archon/v1 with the compile provider registry
import "../providers/archon/index.js";

interface CompileOptions {
  target?: string;
  out?: string;
  strict?: boolean;
  json?: boolean;
}

export async function compile(
  file: string | undefined,
  options: CompileOptions,
): Promise<void> {
  const target = options.target ?? "archon/v1";
  const path = resolveHarnessfilePath(file);

  // Parse → normalize → validate
  const raw = parseHarnessfile(path);
  const ir = normalize(raw as Record<string, unknown>);
  const validation = validateHarnessfile(ir);

  if (!validation.valid) {
    console.error("Harnessfile validation failed:");
    for (const err of validation.errors) {
      console.error(`  ✗ ${err.path}: ${err.message}`);
    }
    process.exit(1);
  }

  // Get compile provider
  let provider;
  try {
    provider = getCompileProvider(target);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    console.error(`Available compile targets: ${listCompileProviders().join(", ")}`);
    process.exit(1);
  }

  // Compile
  const result = provider.compile(ir);

  // Handle warnings
  const errorWarnings = result.warnings.filter((w) => w.severity === "error");
  const hasErrors = errorWarnings.length > 0;

  if (result.warnings.length > 0) {
    console.error(`\n${result.warnings.length} diagnostic(s) from ${provider.displayName}:`);
    for (const w of result.warnings) {
      const tag =
        w.severity === "error" ? "✗" : w.severity === "warning" ? "⚠" : "i";
      const pathPart = w.path ? ` [${w.path}]` : "";
      console.error(`  ${tag} ${w.severity} ${w.code}${pathPart}: ${w.message}`);
      if (w.suggestion) {
        console.error(`    suggestion: ${w.suggestion}`);
      }
    }
  }

  if (options.strict && result.warnings.filter((w) => w.severity !== "info").length > 0) {
    console.error(
      "\n--strict: failing due to non-info diagnostics. Remove --strict to ignore warnings.",
    );
    process.exit(1);
  }

  if (hasErrors) {
    console.error("\nCompilation produced errors; output may be incomplete.");
  }

  // Emit
  if (options.out) {
    const outDir = resolve(options.out);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }
    for (const f of result.files) {
      const target = join(outDir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content, "utf-8");
      console.log(`wrote ${target}`);
    }
    if (options.json) {
      const warningsPath = join(outDir, `${ir.name ?? "harnessfile"}.warnings.json`);
      writeFileSync(warningsPath, JSON.stringify(result.warnings, null, 2), "utf-8");
      console.log(`wrote ${warningsPath}`);
    }
  } else {
    // stdout
    for (const f of result.files) {
      process.stdout.write(f.content);
    }
  }

  process.exit(hasErrors ? 2 : 0);
}
