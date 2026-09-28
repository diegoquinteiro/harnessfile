# Remote worker image

Build the worker from this checkout, using versions of the coding-agent CLIs that you have tested:

```sh
docker build -f examples/remote-worker/Dockerfile \
  --build-arg CLAUDE_CODE_VERSION="$CLAUDE_CODE_VERSION" \
  --build-arg CODEX_VERSION="$CODEX_VERSION" \
  -t ghcr.io/YOUR_ORG/harnessfile-worker:provider-v1 .
docker push ghcr.io/YOUR_ORG/harnessfile-worker:provider-v1
```

Set both version variables before building. The image contains the worker from this repository, Node.js, Git, GitHub CLI, Claude Code, and Codex. Install additional runtime plugins under `/opt/harnessfile/node_modules` when extending the image. Supply credentials only when launching a task. Do not bake credentials into an image.

Modal accepts this registry image directly. Register it as a Daytona snapshot or use its installed worker/runtime files in an E2B custom template through the respective provider's image/template build workflow. These are provider-managed resources; Harnessfile does not publish or build them automatically. E2B templates must retain E2B's own agent and boot requirements. Use the same worker revision as the host.

Example independent execution binding (in `.agents/harness.yaml`):

```yaml
execution:
  provider:
    type: modal/v1
    app: harnessfile
    image: ghcr.io/YOUR_ORG/harnessfile-worker:provider-v1
    repository: https://github.com/YOUR_ORG/YOUR_REPO.git
    ref: main
    timeoutMs: 900000
    envSecrets:
      ANTHROPIC_API_KEY: ANTHROPIC_API_KEY
      HARNESSFILE_GIT_TOKEN: GITHUB_WORKER_TOKEN
      GH_TOKEN: GITHUB_WORKER_TOKEN
```

Replace the provider-specific fields for other environments:

```yaml
# Daytona
type: daytona/v1
snapshot: harnessfile-worker
# E2B
type: e2b/v1
template: YOUR_E2B_TEMPLATE_ID
```

Keep `repository`, `ref`, `timeoutMs`, and `envSecrets` alongside those fields. Install the corresponding verified optional host SDK (`npm install modal@0.10.1`, `npm install @daytona/sdk@0.218.0`, or `npm install e2b@2.51.0`) in the harness workspace. Provider API credentials default to `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`, `DAYTONA_API_KEY`, or `E2B_API_KEY` through the host secret resolver. Runtime credentials and Git access tokens are separate.

The worker checks out the configured committed Git ref in detached HEAD state. For an authorized PR-producing task, tell the agent to create a unique branch, edit and test, commit, push, and open the PR with `gh pr create`. Configure Git author name/email in the image or through the explicit `envSecrets` entries `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL`. `HARNESSFILE_GIT_TOKEN` authenticates Git clone/push through a temporary credential helper; `GH_TOKEN` authenticates the GitHub CLI. The token must have the repository permissions needed for the requested task. Bot identity depends on that token's actual GitHub App/account, not the Git commit author string. GitLab uses `HARNESSFILE_GIT_USERNAME=oauth2` (passed through a named secret) and a GitLab token; extend the image with `glab` if that is the desired PR/MR tool.

Every task gets a fresh sandbox. A later task sees only commits reachable through its configured ref, unless its prompt explicitly asks it to apply the previous task's returned patch. The worker exports a binary-capable Git patch (up to 4 MiB) and original base commit into result metadata before deleting the sandbox. It does not apply patches to the host, carry workspaces between tasks, or retain resumable sessions. Pushing a branch is necessary when changes must persist as a repository branch.

See [remote execution contracts and limitations](../../packages/cli/src/services/execution/README.md).
