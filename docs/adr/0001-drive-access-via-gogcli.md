# Google Drive access via the external gogcli binary

Google Drive ingestion shells out to [gogcli](https://github.com/openclaw/gogcli) (`gog … --json`) instead of using the `googleapis` npm client. The user installs gogcli and completes OAuth in their own terminal (`gog auth`); the app treats it as a host prerequisite, discovers it on `PATH` (overridable via `GOG_PATH`), and never sees or stores Google credentials — tokens live in gogcli's keyring. The trade-off: open-recall stays free of OAuth flows, token refresh, and secret storage, at the cost of depending on an external binary that only works when the app runs on the host (not inside Docker without extra mounting). All gogcli interaction is confined to `src/lib/drive/`, so swapping to a direct API client later is a contained rewrite of that module.

## Considered Options

- **`googleapis` npm client** — the path every Node developer expects. Rejected because it pulls the OAuth desktop flow, token persistence, and credential secrets into a local-first app that currently stores none.
- **Bundling/managing the gogcli binary and driving OAuth from the app UI** — rejected as a large, fragile surface for a single-user tool where "run two terminal commands once" is acceptable.
