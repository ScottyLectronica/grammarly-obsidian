# Security Policy

## Scope

This plugin connects to Grammarly's WebSocket API using session cookies captured from an embedded login webview. It does not transmit your Grammarly credentials to any server other than Grammarly's own (`capi.grammarly.com`). Your `grauth` session token is stored locally in Obsidian's plugin data directory.

## Reporting a Vulnerability

If you discover a security vulnerability in this plugin, please report it by opening a GitHub issue. For issues involving sensitive details, you may contact the maintainer directly through GitHub.

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

We will acknowledge the report within a few days and work to address confirmed vulnerabilities promptly.

## Known Limitations

- The `grauth` session token is stored in plaintext in Obsidian's local data directory. This is consistent with how other Obsidian plugins store credentials, but users on shared machines should be aware.
- This plugin uses Grammarly's unofficial WebSocket API. It is not affiliated with or endorsed by Grammarly.
