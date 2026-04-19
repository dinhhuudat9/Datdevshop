const DEFAULT_BACKEND = ""; // require env.RENDER_ORIGIN or env.BACKEND_ORIGIN in production
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB hard cap to avoid abuse
const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

async function extractCaptchaToken(request) {
  const contentType = request.headers.get("content-type") || "";
  const clone = request.clone(); // do not consume the original body

  try {
    if (contentType.includes("application/json")) {
      const json = await clone.json();
      return (
        json?.recaptcha_token ||
        json?.recaptchaToken ||
        json?.token ||
        json?.["g-recaptcha-response"] ||
        null
      );
    }

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await clone.formData();
      return (
        form.get("g-recaptcha-response") ||
        form.get("recaptcha_token") ||
        form.get("recaptchaToken") ||
        form.get("token")
      );
    }
  } catch {
    // ignore parse errors, fallback to header token or fail verification
  }

  return null;
}

async function verifyCaptcha(request, env) {
  const secret = env.TURNSTILE_SECRET || env.RECAPTCHA_SECRET;
  const verifyUrl = env.TURNSTILE_SECRET ? TURNSTILE_VERIFY_URL : RECAPTCHA_VERIFY_URL;

  // If secret is not configured, skip verification so deploys still work
  if (!secret) return true;

  const headerToken = request.headers.get("x-recaptcha-token");
  const bodyToken = await extractCaptchaToken(request);
  const token = headerToken || bodyToken;

  if (!token) return false;

  const params = new URLSearchParams({
    secret,
    response: token,
  });

  // remoteip improves Google scoring when available
  if (request.cf?.clientIp) params.set("remoteip", request.cf.clientIp);

  const res = await fetch(verifyUrl, {
    method: "POST",
    body: params,
  });

  if (!res.ok) return false;

  const data = await res.json();
  return Boolean(data?.success);
}

function shouldCache(request) {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  const { pathname } = new URL(request.url);
  return /\.(js|css|png|jpe?g|gif|svg|ico|woff2?)$/i.test(pathname);
}

const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function handleOptions(request) {
  // Minimal CORS support; adjust allow-origin if you want to lock it down
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(","),
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
    "Access-Control-Max-Age": "86400",
  };
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request, env) {
    // Basic method guard
    if (!ALLOWED_METHODS.includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const backendOrigin = env.RENDER_ORIGIN || env.BACKEND_ORIGIN || DEFAULT_BACKEND;
    if (!backendOrigin) {
      return new Response("Backend origin not configured", { status: 500 });
    }
    const backend = new URL(backendOrigin);
    const url = new URL(request.url);
    url.protocol = backend.protocol;
    url.hostname = backend.hostname;
    url.port = backend.port;

    // Quick size gate to avoid large payloads hitting the backend
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return new Response("Payload Too Large", { status: 413 });
    }

    // Verify captcha (Turnstile preferred, fallback to reCAPTCHA) for POST requests
    if (request.method === "POST") {
      const ok = await verifyCaptcha(request, env);
      if (!ok) {
        return new Response("Captcha failed", { status: 403 });
      }
    }

    const backendRequest = new Request(url.toString(), request);

    // Cache static assets at the edge; everything else just proxies through
    const cf = shouldCache(request) ? { cacheEverything: true } : undefined;

    return fetch(backendRequest, { cf });
  },
};
