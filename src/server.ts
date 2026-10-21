import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  );
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as {
      unhandled?: unknown;
      message?: unknown;
    };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Hosts that belong to the main app. Anything else that reaches us is a
// customer's own domain pointed at their website.
function isAppHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0] ?? "";
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".vercel.app") ||
    h === "uptrendscaling.com" ||
    h.endsWith(".uptrendscaling.com") ||
    h === "getuptrendscaling.com" ||
    h.endsWith(".getuptrendscaling.com") ||
    h === "tryuptrendscaling.com" ||
    h.endsWith(".tryuptrendscaling.com")
  );
}

// A customer's own domain: serve their website, their uploaded pictures and
// their quote form, and nothing else. Returns null for the main app.
async function serveCustomDomain(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const rawHost =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    url.host;
  if (!rawHost || isAppHost(rawHost)) return null;
  const host = (rawHost.toLowerCase().split(":")[0] ?? "").replace(
    /^www\./,
    "",
  );
  const sites = await import("./lib/site-gen/sites.server");
  if (url.pathname === "/" && request.method === "GET") {
    return sites.serveSite({ host });
  }
  if (url.pathname.startsWith("/site-assets/") && request.method === "GET") {
    return sites.serveAsset(url.pathname.slice("/site-assets/".length));
  }
  if (url.pathname === "/__lead" && request.method === "POST") {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const result = await sites.handleLead({ host }, body);
    return new Response(JSON.stringify(result.json), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nAllow: /\n", {
      headers: { "content-type": "text/plain" },
    });
  }
  return Response.redirect(`${url.protocol}//${url.host}/`, 302);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const custom = await serveCustomDomain(request);
      if (custom) return custom;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
