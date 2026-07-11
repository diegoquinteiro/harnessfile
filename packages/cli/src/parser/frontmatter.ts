import { parse as parseYaml } from "yaml";

// Splits a Markdown document into YAML frontmatter and body.
// The frontmatter block is delimited by `---` lines at the very top of the file.

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function splitFrontmatter(content: string): FrontmatterResult {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { frontmatter: {}, body: content };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      const yamlBlock = lines.slice(1, i).join("\n");
      const parsed = parseYaml(yamlBlock);
      const frontmatter =
        parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      const body = lines
        .slice(i + 1)
        .join("\n")
        .replace(/^\n+/, "");
      return { frontmatter, body };
    }
  }
  // Opening `---` with no closing delimiter — treat the whole file as body.
  return { frontmatter: {}, body: content };
}
