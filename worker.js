const ALLOWED_ORIGINS = new Set([
  "https://tedxmanhattanuni.com",
  "https://www.tedxmanhattanuni.com"
]);
const OWNER = "momoka96";
const REPO = "tedxmanhattan-university";
const BRANCH = "main";

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://tedxmanhattanuni.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TEDx-Manhattan-Visual-Editor",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    throw new Error("GitHub API (" + response.status + "): " + (data.message || "request failed"));
  }
  return data;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return new Response("Origin not allowed", { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ success: false, error: "Origin not allowed." }, 403, origin);
    }

    if (request.method === "GET") {
      return jsonResponse({ success: true, message: "TEDx visual editor publishing service is running." }, 200, origin);
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "Use POST to publish changes." }, 405, origin);
    }

    if (!env.EDITOR_PASSWORD || !env.GITHUB_TOKEN) {
      return jsonResponse({ success: false, error: "Publishing service is missing required Cloudflare secrets. Check EDITOR_PASSWORD and GITHUB_TOKEN." }, 500, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "Request body must be valid JSON." }, 400, origin);
    }

    if (!payload || typeof payload.password !== "string" || payload.password !== env.EDITOR_PASSWORD) {
      return jsonResponse({ success: false, error: "Incorrect editor password." }, 401, origin);
    }

    const files = payload.files;
    if (!files || typeof files["index.html"] !== "string" || typeof files["style.css"] !== "string") {
      return jsonResponse({ success: false, error: "The request must include index.html and style.css." }, 400, origin);
    }

    try {
      for (const path of ["index.html", "style.css"]) {
        const apiPath = "/repos/" + OWNER + "/" + REPO + "/contents/" + path;
        const existing = await githubRequest(apiPath + "?ref=" + BRANCH, env.GITHUB_TOKEN);
        await githubRequest(apiPath, env.GITHUB_TOKEN, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Publish website changes from visual editor",
            content: base64Utf8(files[path]),
            sha: existing.sha,
            branch: BRANCH
          })
        });
      }
      return jsonResponse({ success: true, message: "Website files published to GitHub. GitHub Pages may take a few minutes to update." }, 200, origin);
    } catch (error) {
      return jsonResponse({ success: false, error: error && error.message ? error.message : "Publishing failed." }, 500, origin);
    }
  }
};
