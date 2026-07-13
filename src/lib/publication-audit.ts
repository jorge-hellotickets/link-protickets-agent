// Post-publication link audit. Fetches the article where the paid link should
// appear, finds anchors pointing to any protickets variant, and verifies:
// - the href is https://www.protickets.com (no http, no redirect chain)
// - the final URL matches the negotiated target URL
// - the anchor text is not a raw URL (and, if we agreed on one, matches)
// - the anchor isn't rel=nofollow or rel=sponsored
//
// Output is a structured `PublicationAudit` suitable for storing on
// LinkDeal.audit (Json) and composing a fix-request email.

const CANONICAL_HOST = "www.protickets.com";
const PROTICKETS_HOST_RE = /(^|\.)protickets\.com$/i;

export type PublicationAuditIssue =
  | "missing"                 // no protickets anchor found
  | "http_not_https"          // href uses http://
  | "redirect"                // href resolves to a different URL
  | "wrong_host"              // final host is not www.protickets.com
  | "wrong_target"            // final URL path doesn't match the agreed target
  | "raw_url_anchor"          // anchor text is the URL itself
  | "wrong_anchor_text"       // anchor text differs from agreed anchorText
  | "nofollow"                // rel contains nofollow
  | "sponsored"               // rel contains sponsored
  | "fetch_failed";           // couldn't fetch the article

export interface PublicationAuditAnchor {
  href: string;
  finalUrl: string | null;
  anchorText: string;
  rel: string | null;
  issues: PublicationAuditIssue[];
}

export interface PublicationAudit {
  ok: boolean;
  checkedAt: string;
  linkUrl: string;
  targetUrl: string;
  expectedAnchorText: string | null;
  anchors: PublicationAuditAnchor[];
  issues: PublicationAuditIssue[]; // union of all anchor issues (or ["missing"]/["fetch_failed"])
  error?: string;
}

function normalizeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    url.hash = "";
    if (url.pathname === "") url.pathname = "/";
    // drop trailing slash (but keep root "/")
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function sameTargetPath(finalUrl: string, targetUrl: string): boolean {
  try {
    const a = new URL(finalUrl);
    // LinkTarget.url is stored as a relative path (e.g. "/es-es/deportes/..."),
    // so resolve against the canonical protickets host before comparing.
    const b = new URL(targetUrl, `https://${CANONICAL_HOST}`);
    if (a.host.toLowerCase() !== b.host.toLowerCase()) return false;
    const ap = a.pathname.replace(/\/+$/, "");
    const bp = b.pathname.replace(/\/+$/, "");
    return ap === bp;
  } catch {
    return false;
  }
}

async function resolveFinalUrl(href: string): Promise<string | null> {
  try {
    const res = await fetch(href, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return res.url || href;
  } catch {
    // Fall back to GET (some hosts reject HEAD)
    try {
      const res = await fetch(href, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      return res.url || href;
    } catch {
      return null;
    }
  }
}

interface RawAnchor {
  href: string;
  text: string;
  rel: string | null;
}

// Extract every <a> with an href containing "protickets" (case-insensitive).
function extractProticketsAnchors(html: string): RawAnchor[] {
  const anchors: RawAnchor[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[1] ?? m[2] ?? "").trim();
    if (!/protickets\.com/i.test(href)) continue;
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const relMatch = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const rel = relMatch ? (relMatch[1] ?? relMatch[2] ?? "").toLowerCase() : null;
    const text = m[3]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    anchors.push({ href, text, rel });
  }
  return anchors;
}

function auditAnchor(
  a: RawAnchor,
  finalUrl: string | null,
  targetUrl: string,
  expectedAnchorText: string | null,
): PublicationAuditAnchor {
  const issues: PublicationAuditIssue[] = [];

  if (/^http:\/\//i.test(a.href)) issues.push("http_not_https");

  const normHref = normalizeUrl(a.href);
  const normFinal = finalUrl ? normalizeUrl(finalUrl) : null;
  if (normHref && normFinal && normHref !== normFinal) issues.push("redirect");

  if (normFinal) {
    try {
      const host = new URL(normFinal).host.toLowerCase();
      if (!PROTICKETS_HOST_RE.test(host) || host !== CANONICAL_HOST) {
        if (host !== CANONICAL_HOST) issues.push("wrong_host");
      }
    } catch {
      // ignore
    }
    if (!sameTargetPath(normFinal, targetUrl)) issues.push("wrong_target");
  }

  if (a.rel) {
    if (/\bnofollow\b/.test(a.rel)) issues.push("nofollow");
    if (/\bsponsored\b/.test(a.rel)) issues.push("sponsored");
  }

  if (/^https?:\/\//i.test(a.text.trim())) {
    issues.push("raw_url_anchor");
  } else if (expectedAnchorText) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    // Accept either the agreed anchor text or the brand fallback — publishers
    // frequently default to "Protickets.com" and link diversity is desirable
    // across the portfolio, so we don't force a rewrite when the brand was
    // used instead of the negotiated keyword anchor.
    const actual = norm(a.text);
    const brandVariants = new Set(["protickets.com", "protickets", "www.protickets.com"]);
    if (actual !== norm(expectedAnchorText) && !brandVariants.has(actual)) {
      issues.push("wrong_anchor_text");
    }
  }

  return {
    href: a.href,
    finalUrl: normFinal,
    anchorText: a.text,
    rel: a.rel,
    issues,
  };
}

export async function auditPublication(params: {
  linkUrl: string;
  targetUrl: string;
  expectedAnchorText: string | null;
}): Promise<PublicationAudit> {
  const { linkUrl, targetUrl, expectedAnchorText } = params;
  const checkedAt = new Date().toISOString();

  let html: string;
  try {
    const res = await fetch(linkUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Many WAFs (Cloudflare, Sucuri) block server-declared bots, so we
        // impersonate a real Chrome on macOS. Keep headers minimal — some
        // origins 404 on unexpected header combinations.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        checkedAt,
        linkUrl,
        targetUrl,
        expectedAnchorText,
        anchors: [],
        issues: ["fetch_failed"],
        error: `HTTP ${res.status} ${res.statusText || ""}`.trim(),
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      checkedAt,
      linkUrl,
      targetUrl,
      expectedAnchorText,
      anchors: [],
      issues: ["fetch_failed"],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const raws = extractProticketsAnchors(html);
  if (raws.length === 0) {
    return {
      ok: false,
      checkedAt,
      linkUrl,
      targetUrl,
      expectedAnchorText,
      anchors: [],
      issues: ["missing"],
    };
  }

  // Resolve final URLs in parallel (cap concurrency at the number of anchors;
  // in practice 1–2 per article).
  const finals = await Promise.all(raws.map((r) => resolveFinalUrl(r.href)));
  const anchors = raws.map((r, i) =>
    auditAnchor(r, finals[i], targetUrl, expectedAnchorText),
  );

  // The "best" anchor is the one with fewest issues. If any anchor is clean,
  // the publication is OK.
  const hasClean = anchors.some((a) => a.issues.length === 0);
  const union = new Set<PublicationAuditIssue>();
  if (!hasClean) {
    for (const a of anchors) for (const i of a.issues) union.add(i);
  }

  return {
    ok: hasClean,
    checkedAt,
    linkUrl,
    targetUrl,
    expectedAnchorText,
    anchors,
    issues: Array.from(union),
  };
}

export function summarizeAuditIssuesEs(audit: PublicationAudit): string {
  if (audit.ok) return "El enlace está correctamente colocado.";
  const parts: string[] = [];
  const best = audit.anchors.length
    ? audit.anchors.reduce((a, b) => (a.issues.length <= b.issues.length ? a : b))
    : null;

  for (const issue of audit.issues) {
    switch (issue) {
      case "missing":
        parts.push("No encuentro ningún enlace a Protickets.com en el artículo.");
        break;
      case "http_not_https":
        parts.push(`El enlace usa http:// en vez de https:// (href actual: ${best?.href ?? "-"}).`);
        break;
      case "redirect":
        parts.push(
          `El enlace pasa por una redirección (${best?.href ?? "-"} → ${best?.finalUrl ?? "-"}). Conviene apuntar directamente a la URL final para no perder fuerza SEO.`,
        );
        break;
      case "wrong_host":
        parts.push("El enlace no apunta a www.protickets.com (falta el www o usa otro dominio).");
        break;
      case "wrong_target":
        parts.push(
          `El enlace apunta a ${best?.finalUrl ?? "la home"} en vez de la URL acordada (${audit.targetUrl}).`,
        );
        break;
      case "raw_url_anchor":
        parts.push("El texto ancla es la propia URL — queda mejor con un texto descriptivo.");
        break;
      case "wrong_anchor_text":
        parts.push(
          `El texto ancla no coincide con el acordado ("${audit.expectedAnchorText}"). Actual: "${best?.anchorText ?? ""}".`,
        );
        break;
      case "nofollow":
        parts.push("El enlace tiene rel=\"nofollow\".");
        break;
      case "sponsored":
        parts.push("El enlace tiene rel=\"sponsored\".");
        break;
      case "fetch_failed":
        parts.push(`No he podido acceder al artículo (${audit.error ?? "sin detalle"}).`);
        break;
    }
  }
  return parts.join(" ");
}
