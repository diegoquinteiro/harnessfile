// Minimal TOML emitter — enough for the Codex agent files. Hand-rolled on purpose:
// strings are escaped properly and long text uses multiline basic strings.

export function tomlString(value: string): string {
  return `"${escapeBasic(value)}"`;
}

export function tomlMultilineString(value: string): string {
  // Multiline basic string: escape backslashes, strip CR, and escape any
  // triple-quote runs so the delimiter cannot be terminated early.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "")
    .replace(/"""/g, '\\"\\"\\"');
  return `"""\n${escaped}\n"""`;
}

export function tomlKeyValue(key: string, value: string | string[]): string {
  if (Array.isArray(value)) {
    return `${key} = [${value.map(tomlString).join(", ")}]`;
  }
  if (value.includes("\n")) {
    return `${key} = ${tomlMultilineString(value)}`;
  }
  return `${key} = ${tomlString(value)}`;
}

function escapeBasic(value: string): string {
  let out = "";
  for (const char of value) {
    switch (char) {
      case "\\":
        out += "\\\\";
        break;
      case '"':
        out += '\\"';
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default: {
        const code = char.charCodeAt(0);
        if (code < 0x20) {
          out += `\\u${code.toString(16).padStart(4, "0")}`;
        } else {
          out += char;
        }
      }
    }
  }
  return out;
}
