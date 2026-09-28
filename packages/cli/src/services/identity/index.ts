import { createSign } from "node:crypto";
import type { ProviderRef } from "../../ir/types.js";
import type { ActorIdentity, IdentityService, ProviderRegistrar, ServiceContext } from "../contracts.js";
import { apiUrl, JsonApi, object, string, type HttpFetch } from "../project-management/http.js";

interface GitHubMapping { appId: string; installationId: string; privateKeySecret: string; subject: string }
interface GitLabMapping { tokenSecret: string; subject: string }

function mappings<T>(config: ProviderRef, parse: (value: unknown) => T): { fallback?: T; agents: Map<string, T> } {
  for (const key of ["token", "credential", "privateKey"]) if (key in config) throw new Error(`Identity config accepts secret references, not '${key}'`);
  const agents = new Map<string, T>();
  if (config.agents !== undefined) for (const [agent, value] of Object.entries(object(config.agents, "agents"))) agents.set(agent, parse(value));
  const fallback = config.default === undefined ? undefined : parse(config.default);
  if (!fallback && agents.size === 0) throw new Error("Identity provider needs default or agents mappings");
  return { fallback, agents };
}

function numericId(value: unknown, name: string): string {
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d*$/.test(String(value))) throw new Error(`${name} must be a positive integer ID`);
  return String(value);
}

function checkAudience(audience: string, provider: string, endpoint: string): void {
  if (audience !== provider && audience !== endpoint) throw new Error(`Identity cannot be used for audience '${audience}'`);
}

/** Each mapping represents an actual GitHub App; a shared default uses one visible bot. */
export class GitHubAppIdentity implements IdentityService {
  private readonly api: JsonApi;
  private readonly mappings: ReturnType<typeof mappings<GitHubMapping>>;
  private readonly tokens = new Map<string, { credential: string; expires: number }>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(config: ProviderRef, private readonly context: Pick<ServiceContext, "secret">, fetcher?: HttpFetch, private readonly now = Date.now) {
    this.api = new JsonApi("GitHub", apiUrl(config.apiUrl, "https://api.github.com"), fetcher);
    this.mappings = mappings(config, (value) => {
      const mapping = object(value, "GitHub App mapping");
      if ("privateKey" in mapping || "token" in mapping || "credential" in mapping) throw new Error("GitHub App mappings accept privateKeySecret references only");
      return {
        appId: numericId(mapping.appId, "appId"), installationId: numericId(mapping.installationId, "installationId"),
        privateKeySecret: string(mapping.privateKeySecret, "privateKeySecret"), subject: string(mapping.subject, "subject"),
      };
    });
  }

  async resolve(agent: string, audience: string): Promise<ActorIdentity> {
    checkAudience(audience, "github/v1", this.api.base);
    const mapping = this.mappings.agents.get(agent) ?? this.mappings.fallback;
    if (!mapping) throw new Error(`No GitHub identity mapping for agent '${agent}'`);
    const key = JSON.stringify([mapping.appId, mapping.installationId, mapping.privateKeySecret]);
    const cached = this.tokens.get(key);
    if (cached && cached.expires > this.now() + 60_000) return { subject: mapping.subject, credential: cached.credential };
    let minting = this.pending.get(key);
    if (!minting) {
      minting = this.mint(mapping, key);
      this.pending.set(key, minting);
    }
    try { return { subject: mapping.subject, credential: await minting }; }
    finally { if (this.pending.get(key) === minting) this.pending.delete(key); }
  }

  private async mint(mapping: GitHubMapping, key: string): Promise<string> {
    const seconds = Math.floor(this.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: mapping.appId })).toString("base64url");
    const payload = `${header}.${claims}`;
    const privateKey = await this.context.secret(mapping.privateKeySecret);
    let jwt: string;
    try { jwt = `${payload}.${createSign("RSA-SHA256").update(payload).sign(privateKey, "base64url")}`; }
    catch { throw new Error("Unable to sign GitHub App JWT; check the private key secret"); }
    const response = await this.api.request<{ token: string; expires_at: string }>(`/app/installations/${mapping.installationId}/access_tokens`, jwt, "POST", {});
    const credential = string(response.token, "GitHub installation token");
    const expires = Date.parse(response.expires_at);
    if (!Number.isFinite(expires) || expires <= this.now()) throw new Error("GitHub returned an invalid installation token expiry");
    this.tokens.set(key, { credential, expires });
    return credential;
  }

  async close(): Promise<void> { this.tokens.clear(); }
}

/** Tokens are minted/rotated by the operator; this provider resolves secret references only. */
export class GitLabServiceAccountIdentity implements IdentityService {
  private readonly endpoint: string;
  private readonly mappings: ReturnType<typeof mappings<GitLabMapping>>;

  constructor(config: ProviderRef, private readonly context: Pick<ServiceContext, "secret">) {
    this.endpoint = apiUrl(config.apiUrl, "https://gitlab.com/api/v4");
    this.mappings = mappings(config, (value) => {
      const mapping = object(value, "GitLab service account mapping");
      if ("token" in mapping || "credential" in mapping) throw new Error("GitLab mappings accept tokenSecret references only");
      return { tokenSecret: string(mapping.tokenSecret, "tokenSecret"), subject: string(mapping.subject, "subject") };
    });
  }

  async resolve(agent: string, audience: string): Promise<ActorIdentity> {
    checkAudience(audience, "gitlab/v1", this.endpoint);
    const mapping = this.mappings.agents.get(agent) ?? this.mappings.fallback;
    if (!mapping) throw new Error(`No GitLab identity mapping for agent '${agent}'`);
    return { subject: mapping.subject, credential: string(await this.context.secret(mapping.tokenSecret), "GitLab service account token") };
  }
}

export function registerIdentityProviders(registry: ProviderRegistrar): void {
  registry.register("identity", "github-app/v1", (config, context) => new GitHubAppIdentity(config, context));
  registry.register("identity", "gitlab-service-account/v1", (config, context) => new GitLabServiceAccountIdentity(config, context));
}
