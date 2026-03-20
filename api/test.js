const { randomUUID } = require("crypto");

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;
  for (const [name, value] of Object.entries(extraHeaders)) {
    res.setHeader(name, value);
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseTargetUrls(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(isHttpUrl);
}

function parseTimeoutMs(value) {
  const num = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(num) || num < 1000 || num > 59000) {
    return 58000;
  }
  return num;
}

async function requestUpstream(targetBaseUrl, inputUrl, correlationId, timeoutMs) {
  const endpoint = new URL("/api/resolve", targetBaseUrl);
  endpoint.searchParams.set("url", inputUrl);

  let response;
  try {
    response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        "x-correlation-id": correlationId,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ok: false,
      reason: error && error.name === "TimeoutError" ? "timeout" : "network_error",
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return { ok: false, reason: `http_${response.status}` };
  }

  const directLink = String((payload && payload.url) || "").trim();
  if (!isHttpUrl(directLink)) {
    return { ok: false, reason: "invalid_payload" };
  }

  return {
    ok: true,
    url: directLink,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, {
      error: "method_not_allowed",
      detail: "Only GET is allowed for this endpoint.",
    }, { Allow: "GET" });
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;
  if (pathname !== "/" && pathname !== "/resolve" && pathname !== "/api/test") {
    sendJson(res, 404, { error: "not_found", detail: `Unknown route: ${pathname}` });
    return;
  }

  const inputUrl = String(reqUrl.searchParams.get("url") || "").trim();
  if (!isHttpUrl(inputUrl)) {
    sendJson(res, 400, {
      error: "bad_request",
      detail: "Provide a valid http(s) url query parameter.",
    });
    return;
  }

  const targetUrls = parseTargetUrls(process.env.TARGET_URLS);
  if (targetUrls.length === 0) {
    sendJson(res, 500, {
      error: "server_not_configured",
      detail: "TARGET_URLS is empty or invalid.",
    });
    return;
  }

  const timeoutMs = parseTimeoutMs(process.env.REQUEST_TIMEOUT_MS);
  const correlationId = String(req.headers["x-correlation-id"] || "").trim() || randomUUID();
  const targetCount = targetUrls.length;
  const offset = Number.parseInt(String(Date.now() % targetCount), 10);

  let lastReason = "unknown";
  for (let i = 0; i < targetCount; i++) {
    const targetIndex = (offset + i) % targetCount;
    const targetUrl = targetUrls[targetIndex];
    const result = await requestUpstream(targetUrl, inputUrl, correlationId, timeoutMs);

    if (result.ok) {
      sendJson(res, 200, {
        url: result.url,
        source: "upstream_pool",
        target: targetUrl,
        tried: i + 1,
      });
      return;
    }

    lastReason = result.reason;
  }

  sendJson(res, 502, {
    error: "all_upstreams_failed",
    detail: lastReason,
  });
};
