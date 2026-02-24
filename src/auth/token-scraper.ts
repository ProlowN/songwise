const MUSIC_URL = "https://music.apple.com/us/browse";
const BETA_URL = "https://beta.music.apple.com";

export async function scrapeDevToken(): Promise<string> {
  let method1Error: string | undefined;
  let method2Error: string | undefined;

  // Method 1: Extract from <meta> tag on music.apple.com
  try {
    const token = await extractFromMeta(MUSIC_URL);
    if (token) return token;
    method1Error = "no token found in page meta tags";
  } catch (err) {
    method1Error = err instanceof Error ? err.message : String(err);
  }

  // Method 2: Extract from JS bundle on beta.music.apple.com
  try {
    const token = await extractFromJsBundle(BETA_URL);
    if (token) return token;
    method2Error = "no token found in JS bundle";
  } catch (err) {
    method2Error = err instanceof Error ? err.message : String(err);
  }

  throw new Error(
    "Could not scrape developer token from Apple Music web player.\n" +
      `  Method 1 (${MUSIC_URL}): ${method1Error}\n` +
      `  Method 2 (${BETA_URL}): ${method2Error}`,
  );
}

async function extractFromMeta(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  const match = html.match(
    /name="desktop-music-app\/config\/environment"\s+content="([^"]+)"/,
  );
  if (!match) return null;

  let config: Record<string, unknown>;
  try {
    const decoded = decodeURIComponent(match[1]);
    config = JSON.parse(decoded);
  } catch {
    throw new Error(`Found config meta tag on ${url} but could not parse it as JSON`);
  }
  return (config?.MEDIA_API as Record<string, unknown>)?.token as string ?? null;
}

async function extractFromJsBundle(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  // Find the legacy JS bundle URL
  const jsMatch = html.match(/\/assets\/index-legacy-[^"'\s]+\.js/);
  if (!jsMatch) return null;

  const jsUrl = new URL(jsMatch[0], url).href;
  const jsRes = await fetch(jsUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
  });
  if (!jsRes.ok) {
    throw new Error(`Failed to fetch JS bundle: ${jsRes.status} ${jsRes.statusText}`);
  }
  const js = await jsRes.text();

  // JWT pattern: eyJ followed by base64url characters with two dots
  const tokenMatch = js.match(
    /eyJh[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{50,}/,
  );
  return tokenMatch?.[0] ?? null;
}
