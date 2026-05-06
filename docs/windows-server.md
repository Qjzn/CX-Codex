# Windows Server Setup

This project now supports a config-driven Windows deployment flow that works well for LAN access, reverse proxies, and fixed browser ports.

## 1. One-command install

For most users, this is the easiest path:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

Default behavior:

- installs Node.js automatically if needed
- downloads the latest repo to `%LOCALAPPDATA%\CX-Codex`
- creates `%USERPROFILE%\CodexWorkspace`
- creates `%USERPROFILE%\.local\bin\cx-codex-start.cmd`
- creates an auto-start task at logon
- attempts to open firewall port `7420`
- starts the service immediately

You can rerun the same command later to change the port, password, or workspace. The installer updates the same config and launcher, then restarts the managed instance with the new settings.

If you want custom options such as a fixed password:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) `
  -Port 7420 `
  -Password 'change-me'
```

If you want a temporary HTTPS address without router port mapping:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) `
  -EnableCloudflareTunnel
```

This downloads `cloudflared.exe` to the user profile, enables `tunnel: true`, and prints the `trycloudflare.com` URL in `%USERPROFILE%\.cx-codex\logs\cx-codex.out.log`.

If you prefer a downloadable bundle, grab the latest zip from [GitHub Releases](https://github.com/Qjzn/CX-Codex/releases), extract it anywhere, and run:

```powershell
.\setup.ps1
```

## 2. Build from source

```powershell
cd .\CX-Codex
npm install
npm run build
```

## 3. Generate config + launcher

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-server.ps1 `
  -ProjectPath "$env:USERPROFILE\CodexWorkspace" `
  -CreateProjectPath `
  -Port 7420 `
  -Password "change-me" `
  -CreateStartupTask `
  -EnsureCodexLogin `
  -OpenFirewall `
  -InstallCloudflared `
  -Tunnel `
  -StartNow
```

The script writes:

- a stable JSON config file at `%USERPROFILE%\.cx-codex\config.json`
- a launcher at `%USERPROFILE%\.local\bin\cx-codex-start.cmd`

By default the installer writes `tunnel: false` and `open: false`, which is usually the right choice for Windows server usage.

## 4. Health checks

- Basic health: `http://<host>:<port>/health`
- Detailed bridge health: `http://<host>:<port>/codex-api/health`

`/health` is intentionally lightweight so it can be used by reverse proxies and process monitors.

## 5. Optional config locations

`cx-codex` will automatically load config from the first file it finds:

1. `--config <path>`
2. `CX_CODEX_CONFIG`
3. `./cx-codex.config.json`
4. `%USERPROFILE%\.cx-codex\config.json`

See [cx-codex.config.example.json](../cx-codex.config.example.json) for the supported keys.

Release process notes for maintainers live in [RELEASE.md](../RELEASE.md).

## 6. Reverse proxy notes

- Bind with `0.0.0.0` for LAN or reverse-proxy access.
- Keep `/health`, `/codex-api/events`, and `/codex-api/ws` reachable through the proxy.
- If you use an external tunnel or port mapping, prefer `--no-tunnel` and let your own ingress handle exposure.
