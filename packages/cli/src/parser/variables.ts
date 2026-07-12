// Substitutes environment variable references in a Harnessfile YAML source
// before YAML parsing.
//
// Two syntaxes are supported depending on the Harnessfile version declared
// at the top of the file:
//
// - v0.1 — Docker Compose style: `${VAR}` / `${VAR:-default}`. This collides
//   with POSIX shell parameter expansion inside `bash:` blocks, so v0.2
//   replaces it with a non-colliding syntax.
//
// - v0.2 — GitHub Actions style: `${{ VAR }}` / `${{ VAR:-default }}`. The
//   double-brace form is unambiguous: bash scripts embedded as block scalars
//   can use `${VAR}` freely because the substituter only matches `${{ ... }}`.
//
// Detection is a simple regex over the raw text looking for the
// `harnessfile:` version key. This runs before YAML parsing so we can't rely
// on a structured parse.

const V01_PATTERN = /\$\{([^{}][^}]*)\}/g;
const V02_PATTERN = /\$\{\{\s*([^}]+?)\s*\}\}/g;
const VERSION_PATTERN = /^\s*harnessfile\s*:\s*["']?(\d+\.\d+)["']?/m;

export function substituteVariables(
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const version = detectVersion(raw);
  const pattern = version === "0.1" ? V01_PATTERN : V02_PATTERN;

  return raw.replace(pattern, (_match, expr: string) => {
    const trimmed = expr.trim();
    const sepIndex = trimmed.indexOf(":-");
    if (sepIndex !== -1) {
      const name = trimmed.slice(0, sepIndex).trim();
      const fallback = trimmed.slice(sepIndex + 2);
      return env[name] ?? fallback;
    }
    const value = env[trimmed];
    if (value === undefined) {
      throw new Error(
        `Environment variable \${${trimmed}} is required but not set`,
      );
    }
    return value;
  });
}

function detectVersion(raw: string): string {
  const match = raw.match(VERSION_PATTERN);
  return match ? match[1] : "0.1";
}
