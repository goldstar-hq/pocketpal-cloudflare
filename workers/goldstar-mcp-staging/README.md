# Goldstar MCP Staging

This repository path contains an isolated staging MCP authorization and resource service. It is not the production L1 Worker and is not a trading-execution interface.

## Components

- `auth/`: OAuth 2.1 authorization server, Google OpenID Connect sign-in, owner-email allowlist, per-client consent, PKCE, and token issuance.
- `resource/`: Streamable HTTP MCP resource server. It validates access tokens through a Cloudflare Service Binding to the authorization Worker and exposes tools according to the approved scopes.
- `OAUTH_KV`: KV namespace used by the authorization server for OAuth state and token records.

The initially allowlisted owner identity is `goldstar.al.manager@gmail.com`. Google ID tokens are verified for signature, issuer, audience, nonce, expiry, verified email, and the owner allowlist. Raw Google tokens are never returned to MCP clients.

## MCP endpoint and scopes

Resource endpoint:

`https://goldstar-mcp-resource-staging.goldstar-al-manager.workers.dev/mcp`

The resource requires `mcp:read`. Additional Google Cloud tools are registered only for the owner and only when the corresponding scope is present:

| Scope | Tools / capability |
|---|---|
| `mcp:read` | `goldstar_mcp_status`, `goldstar_authenticated_identity` |
| `gcp:read` | `gcp_project_info`, `gcp_list_enabled_apis`, `gcp_operation_status` |
| `gcp:write` | `gcp_enable_api`, subject to the restrictions below |
| `offline_access` | OAuth refresh-token capability |

### Google Cloud write restriction

The only write-capable tool is `gcp_enable_api`. It is limited to this fixed allowlist:

- `cloudresourcemanager.googleapis.com`
- `iam.googleapis.com`
- `iamcredentials.googleapis.com`
- `serviceusage.googleapis.com`
- `sts.googleapis.com`

Every call must include the exact confirmation string:

`ENABLE <serviceId> IN personal-ai-manager-00`

The tool rejects services outside the allowlist and rejects any call without that exact confirmation. Enabling services can change project configuration and may enable billable usage. Do not invoke it unless the owner has explicitly approved the exact service and project. A separate Google Cloud IAM policy still governs the service account's effective permissions.

No trade, order-placement, broker, or production execution tool is exposed by this MCP service.

## Configuration

- Auth Worker: `goldstar-mcp-auth-staging`
- Resource Worker: `goldstar-mcp-resource-staging`
- Google Cloud project: `personal-ai-manager-00`
- WIF pool/provider: `goldstar-mcp-staging / cloudflare-goldstar-mcp`
- Service account: `goldstar-gcp-automation@personal-ai-manager-00.iam.gserviceaccount.com`

The Google OAuth client ID is a non-secret configuration variable in the Worker configuration. The Google OAuth client secret must exist only as the Cloudflare Worker secret `GOOGLE_CLIENT_SECRET`; never commit it to GitHub, source files, logs, or chat. The resource Worker receives Google Cloud configuration through its environment variables and uses a Service Binding to the Auth Worker.

## Deployment order

1. Confirm the Auth Worker's `OAUTH_KV` binding points to the dedicated staging namespace.
2. Confirm the Auth Worker's `GOOGLE_CLIENT_SECRET` secret is configured in Cloudflare.
3. Confirm the Google OAuth client has this exact authorized redirect URI:
   `https://goldstar-mcp-auth-staging.goldstar-al-manager.workers.dev/callback`
4. Deploy the Auth Worker from this staging branch.
5. Confirm the Resource Worker's `AUTH_SERVER` Service Binding targets `goldstar-mcp-auth-staging`.
6. Deploy the Resource Worker from this staging branch.
7. Complete the end-to-end authorization, token validation, and MCP tool tests before connecting a client.

Do not change the production branch or route production traffic as part of staging validation.

## CI and verification limits

The GitHub Actions workflow performs TypeScript checks, Wrangler dry-runs, and live staging smoke tests. On this PR's current branch, the `push` trigger is the available CI trigger. The `pull_request` trigger becomes effective for later PRs after the workflow file exists in the target branch (for example, `main`); manual `workflow_dispatch` likewise requires the workflow to be present on the default branch. The workflow does not deploy either Worker.

The live smoke checks verify both deployed `/health` endpoints, OAuth metadata and PKCE S256 support, and rejection of an unauthenticated MCP request with HTTP 401.

A successful end-to-end Google authorization-code exchange, refresh-token flow, authenticated MCP request, and Google Cloud WIF/API call have **not** yet been demonstrated. Health, metadata, and unauthenticated-boundary checks alone do not prove those flows. Keep this service in staging until each test is completed and recorded.
