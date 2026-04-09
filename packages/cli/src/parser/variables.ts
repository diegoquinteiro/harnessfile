// Substitutes ${VAR} and ${VAR:-default} patterns from environment variables.
// Applied to raw YAML string before parsing, matching Docker Compose behavior.

const VAR_PATTERN = /\$\{([^}]+)\}/g;

export function substituteVariables(
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return raw.replace(VAR_PATTERN, (_match, expr: string) => {
    const sepIndex = expr.indexOf(":-");
    if (sepIndex !== -1) {
      const name = expr.slice(0, sepIndex);
      const fallback = expr.slice(sepIndex + 2);
      return env[name] ?? fallback;
    }
    const value = env[expr];
    if (value === undefined) {
      throw new Error(
        `Environment variable \${${expr}} is required but not set`,
      );
    }
    return value;
  });
}
