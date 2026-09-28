import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubAppIdentity, GitLabServiceAccountIdentity } from "../src/services/identity/index.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const mapping = { appId: 123, installationId: 456, privateKeySecret: "APP_KEY", subject: "harness[bot]" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("GitHub App identity", () => {
  it("signs a bounded RS256 JWT, deduplicates token issuance, and refreshes before expiry", async () => {
    let now = Date.parse("2026-01-01T00:00:00Z");
    const secret = vi.fn(async () => pem);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const jwt = (init!.headers as Record<string, string>).Authorization.slice(7);
      const [header, claims, signature] = jwt.split(".");
      expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
      expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iat: now / 1000 - 60, exp: now / 1000 + 540, iss: "123" });
      expect(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
      expect(init!.redirect).toBe("error");
      return response({ token: "installation-token", expires_at: new Date(now + 3_600_000).toISOString() });
    });
    const identity = new GitHubAppIdentity({ type: "github-app/v1", default: mapping }, { secret }, fetcher, () => now);
    const actors = await Promise.all([identity.resolve("engineer", "github/v1"), identity.resolve("reviewer", "github/v1")]);
    expect(actors).toEqual([{ subject: "harness[bot]", credential: "installation-token" }, { subject: "harness[bot]", credential: "installation-token" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.github.com/app/installations/456/access_tokens");
    expect(secret).toHaveBeenCalledWith("APP_KEY");
    now += 3_550_000;
    await identity.resolve("engineer", "github/v1");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await identity.close();
    await identity.resolve("engineer", "github/v1");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("uses per-agent credentials and rejects unmapped agents or a different audience", async () => {
    const fetcher = vi.fn(async () => response({ token: "token", expires_at: "2099-01-01T00:00:00Z" }));
    const identity = new GitHubAppIdentity({ type: "github-app/v1", agents: { reviewer: mapping } }, { secret: async () => pem }, fetcher);
    await expect(identity.resolve("engineer", "github/v1")).rejects.toThrow("No GitHub identity");
    await expect(identity.resolve("reviewer", "gitlab/v1")).rejects.toThrow("audience");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose a failed token endpoint's response body or private key", async () => {
    const identity = new GitHubAppIdentity({ type: "github-app/v1", default: mapping }, { secret: async () => pem }, async () => response({ error: "SECRET_ECHO" }, 403));
    await expect(identity.resolve("reviewer", "github/v1")).rejects.toThrow("GitHub request failed (HTTP 403)");
    const invalid = new GitHubAppIdentity({ type: "github-app/v1", default: mapping }, { secret: async () => "SECRET_INVALID_KEY" });
    await expect(invalid.resolve("reviewer", "github/v1")).rejects.toThrow("Unable to sign GitHub App JWT; check the private key secret");
  });

  it("binds credentials to the configured API endpoint", async () => {
    const fetcher = vi.fn(async () => response({ token: "token", expires_at: "2099-01-01T00:00:00Z" }));
    const identity = new GitHubAppIdentity({ type: "github-app/v1", default: mapping }, { secret: async () => pem }, fetcher);
    await expect(identity.resolve("engineer", "https://unrelated.example/api")).rejects.toThrow("audience");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(identity.resolve("engineer", "https://api.github.com")).resolves.toMatchObject({ credential: "token" });
  });
});

describe("GitLab service account identity", () => {
  it("resolves rotating secrets independently for each mapped agent", async () => {
    const secret = vi.fn(async (name: string) => `resolved-${name}`);
    const identity = new GitLabServiceAccountIdentity({ type: "gitlab-service-account/v1", default: { tokenSecret: "DEFAULT", subject: "default-bot" }, agents: { reviewer: { tokenSecret: "REVIEWER", subject: "review-bot" } } }, { secret });
    expect(await identity.resolve("reviewer", "gitlab/v1")).toEqual({ subject: "review-bot", credential: "resolved-REVIEWER" });
    expect(await identity.resolve("engineer", "gitlab/v1")).toEqual({ subject: "default-bot", credential: "resolved-DEFAULT" });
    await expect(identity.resolve("engineer", "github/v1")).rejects.toThrow("audience");
  });

  it("rejects inline credentials and insecure API URLs", () => {
    expect(() => new GitLabServiceAccountIdentity({ type: "gitlab-service-account/v1", default: { token: "raw", subject: "bot" } }, { secret: async () => "" })).toThrow("references");
    expect(() => new GitHubAppIdentity({ type: "github-app/v1", apiUrl: "http://example.com", default: mapping }, { secret: async () => pem })).toThrow("HTTPS");
    expect(() => new GitHubAppIdentity({ type: "github-app/v1", apiUrl: "https://token@example.com", default: mapping }, { secret: async () => pem })).toThrow("credentials");
  });
});
