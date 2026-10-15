// Cloudflare Worker for the TEDx Manhattan University visual editor.
// Required secret: GITHUB_TOKEN (a GitHub token with Contents: Read and write).
// No editor password is used. Keep this Worker URL private where possible: anyone who
// can call this endpoint may be able to publish changes to the website.
const OWNER = "momoka96";
const REPO = "tedxmanhattan-university";
const BRANCH = "main";
const ALLOWED_ORIGINS = new Set([
  "https://tedxmanhattanuni.com",
  "https://www.tedxmanhattanuni.com",
  "https://momoka96.github.io"
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://tedxmanhattanuni.com",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

async function githubRequest(path, token, options = {}) {
  return fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + path, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TEDx-Manhattan-University-Publisher",
      ...(options.headers || {})
    }
  });
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
    if (request.method !== "POST") return json({ error: "Use POST to publish." }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, origin);
    if (!env.GITHUB_TOKEN) return json({ error: "Cloudflare secret GITHUB_TOKEN is missing." }, 500, origin);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Request body must be valid JSON." }, 400, origin); }

    const files = body && body.files;
    if (!files || typeof files["index.html"] !== "string" || typeof files["style.css"] !== "string") {
      return json({ error: "Expected files.index.html and files.style.css." }, 400, origin);
    }

    // Only allow updating these two website files; CNAME and script.js remain untouched.
    for (const path of ["index.html", "style.css"]) {
      const getResponse = await githubRequest(path, env.GITHUB_TOKEN);
      if (!getResponse.ok) {
        const details = await getResponse.text();
        return json({ error: "Could not read " + path + " from GitHub: " + details.slice(0, 300) }, 502, origin);
      }
      const existing = await getResponse.json();
      const putResponse = await githubRequest(path, env.GITHUB_TOKEN, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Publish website changes from visual editor",
          content: toBase64Utf8(files[path]),
          sha: existing.sha,
          branch: BRANCH
        })
      });
      if (!putResponse.ok) {
        const details = await putResponse.text();
        return json({ error: "GitHub could not update " + path + ": " + details.slice(0, 400) }, 502, origin);
      }
    }
    return json({ ok: true, message: "Website files published to GitHub." }, 200, origin);
  }
};
