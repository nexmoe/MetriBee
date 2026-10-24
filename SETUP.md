# Setup

The dashboard and the MCP server read two values from `.env` in the project root: `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY`. They come from a Google Cloud service account. No key file stays on disk.

Start the app with `pnpm start` and open it. Until the credentials are configured, every page opens `/setup`, which shows the instructions below and a **Check connection** action. `pnpm setup:check` runs the same check in the terminal.

The `/setup` page reads the marked blocks below from this file. Edit the text between the markers, not the markers.

## Install

### Docker (recommended)

Images for `linux/amd64` and `linux/arm64` are published to `ghcr.io/nexmoe/metribee` on every push to `main` (`latest`) and every release tag (`X.Y.Z`).

Try demo mode first. It needs no Google account and shows generated data for 8 fictional sites:

```bash
docker run --rm -e DEMO=1 -p 127.0.0.1:5483:5483 ghcr.io/nexmoe/metribee:latest
```

For real data, clone the repo for its `docker-compose.yml` and `.env.example`, fill `.env` (see [Google Analytics credentials](#google-analytics-credentials)), then start it:

```bash
git clone https://github.com/nexmoe/MetriBee.git
cd MetriBee
cp .env.example .env
docker compose pull
docker compose up -d
docker compose exec dashboard node scripts/setup-check.js
```

The app listens on the localhost port in the `ports` line of `docker-compose.yml`. Funnels, widgets and caches are kept in `./.data` and `./.cache`. The container reads `.env` only at start, so run `docker compose up -d` again after you change it.

Without compose:

```bash
docker run -d --name metribee --env-file .env -e HOST=0.0.0.0 -v metribee-data:/app/.data \
  -p 127.0.0.1:5483:5483 ghcr.io/nexmoe/metribee:latest
```

The image has no credentials in it. It reads them from env. The same container serves MCP at `/mcp`. Update with `docker compose pull && docker compose up -d`.

### From source

Needs Node.js 22+ and [`pnpm`](https://pnpm.io/). One install at the root covers the dashboard and the MCP server.

```bash
git clone https://github.com/nexmoe/MetriBee.git
cd MetriBee
pnpm install
pnpm build:ui
cp .env.example .env
pnpm start
```

Open http://localhost:5483. It opens `/setup` until the Google credentials below are in `.env`. Run `pnpm demo` instead of `pnpm start` for demo mode.

## Google Analytics credentials

### With an AI agent

Paste this prompt into Claude Code, Codex, Gemini CLI or any agent that can run commands in the project folder.

<!-- prompt:start -->
```text
Set up Google Analytics access for the MetriBee app in this folder.

1. Check that gcloud is installed and logged in (gcloud auth list). If not, stop and ask me to run: gcloud auth login
2. Create a new Google Cloud project named ga4-dash-<6 random chars>. No billing is needed.
3. Enable analyticsdata.googleapis.com and analyticsadmin.googleapis.com.
4. Create a service account "metribee" and a JSON key for it in a temp folder outside this repo.
5. Copy .env.example to .env if .env is missing. Set GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY from the key (private key in double quotes, newlines as \n). Keep every other line.
6. Run: pnpm setup:check. When it says "key accepted", delete the JSON key file.
7. Show me the client email and tell me to add it as Viewer in GA4 Admin, Account access management. Wait until I say done, then run pnpm setup:check again.

If you have browser tools (Claude in Chrome, Playwright or similar), ask me once if you may use them. If I say yes:
- Use the browser for any step gcloud cannot do, or if gcloud is missing (Cloud Console pages).
- Do step 7 yourself in GA4 Admin, then tell me what you added.
I must sign in to Google myself; never type my password.

Docker: if the app runs in a container, step 6 is: docker compose up -d (it reloads .env), then docker compose exec dashboard node scripts/setup-check.js.

Rules: never print the private key, never commit .env.
If you cannot run shell commands or a browser, give me these steps one at a time with the exact console links, and wait for me after each one.
```
<!-- prompt:end -->

### By hand

<!-- manual:start -->
1. **Create a project.** Open [New Project](https://console.cloud.google.com/projectcreate), give it a name (for example ga4-dash) and click Create. No billing needed.
2. **Turn on the APIs.** Open [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com) and click Enable. Do the same for [Google Analytics Admin API](https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com).
3. **Create a service account.** Open [Create service account](https://console.cloud.google.com/iam-admin/serviceaccounts/create), name it metribee and click Create and close. Skip the optional steps.
4. **Download a key.** Open the new account, Keys tab: Add key, Create new key, JSON, Create. A file downloads.
5. **Fill .env.** Copy `client_email` and `private_key` from that file into `.env` as `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY`. Keep the private key in double quotes with its `\n`.
6. **Check the key.** Run `pnpm setup:check`. When it passes, delete the downloaded file.
7. **Give access in GA4.** In [GA4 Admin](https://analytics.google.com/analytics/web/#/admin), Account access management: click +, Add users, paste the client email, choose Viewer and click Add.
8. **Check the connection.** Come back to this page and click Check connection. Once properties are visible, open the dashboard or connect your AI tool.
<!-- manual:end -->

`pnpm setup:check` exit codes: 0 connected, 1 `.env` values missing, 2 key rejected by Google, 3 no GA4 properties visible yet, 4 GA4 request failed (for example an API is not enabled).

## Use with AI (MCP)

The dashboard serves Streamable HTTP MCP at `http://localhost:5483/mcp` using the latest stable TypeScript SDK v2. Start it with `pnpm start` (or Docker); no separate MCP process is needed. Paste this prompt into your AI tool, or run its command yourself. Replace `<MCP URL>` with the dashboard's `/mcp` URL (the `/setup` page fills it in).

The setup page provides a copyable URL, project-scoped `.mcp.json` and Claude Code command. Use a URL reachable from the machine running the AI client; `localhost` refers to that machine. When using a reverse proxy, set `MCP_PUBLIC_URL` to its externally reachable `/mcp` URL and restart the dashboard.

<!-- mcp-features:start -->
1. **Analytics.** Overview, pages, events, journeys, retention, acquisition, audience, revenue and traffic diagnostics use the dashboard's reports and caches.
2. **Google Search.** Search Console summaries, trends and query/page/country/device reports use the website's matched Search Console property when its optional connection is configured.
3. **Funnels and widgets.** Analyze funnels and preview metric widgets. Save or delete local definitions when requested; sharing is managed in the dashboard.
4. **Connection and quota.** Inspect setup, discover current properties, check cache and quota status, and explicitly refresh a selected property's quota.
5. **Guided analysis.** Read `ga4://capabilities` and `ga4://query-guide`, or use the `analyze_property` prompt to focus on one website.
<!-- mcp-features:end -->

<!-- mcp-verify:start -->
1. **Reconnect the AI client.** Replace any existing command/stdio entry named `ga4` in the same scope, then reload the client's MCP connections. Keep Google credentials in the server's `.env`.
2. **Inspect the connection.** List the server's tools, then call `get_setup_status` and `get_capabilities`. Setup inspection works before Google credentials are configured.
3. **Choose one website.** Call `list_properties`, select its property ID, and ask for a focused report. Reports share the dashboard's cache and quota protection.
<!-- mcp-verify:end -->

<!-- mcp:start -->
```text
Add the MetriBee MCP server to my AI tool.

Transport: Streamable HTTP (http).
Server URL: <MCP URL>
The running dashboard reads Google credentials from its root .env. Do not copy them into the client configuration.
Scope: this project only (.mcp.json in my current project) unless I say all projects.

For Claude Code run:
claude mcp add ga4 --transport http --scope project <MCP URL>
If ga4 is already registered with a command/stdio transport in that scope, remove that entry first and replace it with this HTTP entry.
Then list the tools, run get_setup_status and get_capabilities, and use list_properties to choose a site. Prefer the native dashboard analysis tools and share the existing caches; do not loop reports over all properties. Search Console reports require the server's optional GSC connection.
```
<!-- mcp:end -->

For an MCP-only process, run `pnpm mcp` and use `http://127.0.0.1:5484/mcp` instead. `MCP_HOST` and `MCP_PORT` configure only that process. Both entry points share Google authentication, caches and quota guards. For a reverse proxy, add its hostname to `MCP_ALLOWED_HOSTS`; allow browser origins with `MCP_ALLOWED_ORIGINS`. Both lists accept comma-separated hostnames without ports. Set `MCP_PUBLIC_URL` to the externally reachable `/mcp` URL for the setup prompt. Keep the app behind your existing private access proxy.

## Hosting publicly

The app has no login. Anyone who can reach it sees your GA4 data. Run it on localhost, or put it behind Cloudflare Access or Tailscale before you expose it. With Docker, publish port 5483 on localhost only (`-p 127.0.0.1:5483:5483`) and let the proxy or tunnel reach it there. Both options below reach the app on `127.0.0.1:5483` and open no public port on your server.

**Cloudflare Tunnel plus Access.** Needs a domain on Cloudflare.

```bash
cloudflared tunnel login
cloudflared tunnel create metribee
cloudflared tunnel route dns metribee ga4.example.com
```

`~/.cloudflared/config.yml` (use the tunnel UUID that `create` printed):

```yaml
tunnel: <Tunnel-UUID>
credentials-file: /home/<user>/.cloudflared/<Tunnel-UUID>.json
ingress:
  - hostname: ga4.example.com
    service: http://127.0.0.1:5483
  - service: http_status:404
```

Test with `cloudflared tunnel run metribee`, then run it as a service:

```bash
sudo cloudflared --config /home/<user>/.cloudflared/config.yml service install
sudo systemctl start cloudflared
```

Then add a login in front. In Zero Trust, add the One-time PIN identity provider (Integrations, Identity providers). Then add a self-hosted application for `ga4.example.com` (Access controls, Applications) with an Allow policy for your email addresses. Visitors get a code by email before they see the dashboard.

Docs: [create a tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/), [config file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/), [run as a Linux service](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/), [self-hosted Access app](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

**Tailscale.** Only devices on your tailnet can open it.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg 5483
```

It serves at `https://<machine>.<tailnet>.ts.net` (HTTPS certificates must be on for your tailnet) and stays on after reboot. `tailscale serve reset` turns it off. Do not use Funnel for this app: Funnel makes the URL public, and the app has no login.

Docs: [install on Linux](https://tailscale.com/kb/1031/install-linux), [Tailscale Serve](https://tailscale.com/kb/1312/serve), [`tailscale serve` reference](https://tailscale.com/kb/1242/tailscale-serve).

## Google Search Console

<!-- gsc:start -->
1. **Enable the API.** Enable the [Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com) in your service account's Cloud project. An existing authorized account can be reused; it can belong to a different project from GA4.
2. **Grant website access.** Add the service account's email to the relevant properties in [Search Console](https://search.google.com/search-console). The dashboard requests only `webmasters.readonly` access.
3. **Set the credentials.** Add `GSC_CLIENT_EMAIL` and `GSC_PRIVATE_KEY` to the server's root `.env`. Quote the key and escape newlines as `\n`, as for GA4. Keep credential JSON files outside the repository. Docker: recreate the dashboard container after changing its environment.
4. **Check the website.** Open its Analytics page. The Google Search section checks the connection and matches a whole-host URL-prefix property first, then the most specific Domain property. Unrelated domains, unverified access and path-only properties are not selected. This connection also enables `get_search_console_report` in MCP.
5. **Optional website fallback.** If GA4 cannot provide the web-stream URL, set `GSC_WEBSITE_URLS={"123456789":"https://example.com/"}` in `.env`. This never overrides an available GA4 URL and still requires Search Console access to that website.
<!-- gsc:end -->

The dashboard reloads GSC environment values when checking a connection. Status is available at `GET /api/rybbit/sites/<GA4_PROPERTY_ID>/gsc/status`; reports live at `gsc/summary`, `gsc/time-series`, and `gsc/data?dimensions=query` with `start_date` and `end_date`.

## Supplemental user OAuth

Chrome Web Store properties can be readable by your Google user without allowing a service
account to be added. Supplemental OAuth uses that user's existing read access. The original
service account remains the default for all other properties.

<!-- oauth:start -->
1. In your Google Cloud project's [Google Auth Platform](https://console.cloud.google.com/auth/clients), configure a Desktop app OAuth client.
   Use an app you control. Enable the Analytics Data and Admin APIs in that project.
2. Add GA4_OAUTH_CLIENT_ID and GA4_OAUTH_CLIENT_SECRET to the root .env.
3. Set GA4_OAUTH_ACCOUNT_IDS and GA4_OAUTH_PROPERTY_IDS to comma-separated numeric IDs.
   Both lists are required. Only those properties use the user credentials.
4. Run pnpm oauth:login and open its URL in your signed-in browser. It requests only
   analytics.readonly. The loopback callback uses PKCE and a random state. The refresh token
   is saved atomically to .env with mode 0600. Tokens and authorization codes are never logged.
5. Restart the dashboard, refresh its property cache, and restart the MCP server. If the MCP
   account summaries were previously cached, invalidate that cache or wait for its expiry.
<!-- oauth:end -->

Google's read-only OAuth scope covers the Analytics data accessible to your Google user.
The app restricts supplemental requests to the configured IDs; this does not create a
Google-side per-property scope. You can revoke consent from your Google Account at any time.
Unverified apps left in Testing can require consent again after their refresh token expires.

Official flow: https://developers.google.com/identity/protocols/oauth2/native-app
