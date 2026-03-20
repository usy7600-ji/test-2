# Public Link Broker (Simple)

Minimal Vercel service that forwards requests to a pool of upstream endpoints and returns the first valid link.

## Endpoint

- `GET /?url=<http(s)-url>`
- `GET /resolve?url=<http(s)-url>`

Response on success:

- `200 { "url": "...", "source": "upstream_pool", "target": "...", "tried": 1 }`

## Environment Variables

- `TARGET_URLS` comma-separated upstream base URLs
- `REQUEST_TIMEOUT_MS` per-upstream timeout in milliseconds (default `58000`)

Example:

```
TARGET_URLS=https://endpoint1.example.com,https://endpoint2.example.com
REQUEST_TIMEOUT_MS=58000
```
