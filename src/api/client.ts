import type { ApiResponse } from "./types.js";

const BASE_URL = "https://amp-api.music.apple.com";
const ALLOWED_ORIGIN = "https://amp-api.music.apple.com";

export class AppleMusicClient {
  private developerToken: string;
  private musicUserToken: string;

  constructor(developerToken: string, musicUserToken: string) {
    this.developerToken = developerToken;
    this.musicUserToken = musicUserToken;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.developerToken}`,
      "Music-User-Token": this.musicUserToken,
      Origin: "https://music.apple.com",
      "Content-Type": "application/json",
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    if (url.startsWith("http") && !url.startsWith(ALLOWED_ORIGIN)) {
      throw new Error(`Refusing to send request to unexpected domain: ${new URL(url).origin}`);
    }
    const init: RequestInit = { method, headers: this.headers };
    if (body) init.body = JSON.stringify(body);

    let res = await fetch(url, init);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      const wait = Math.min(Math.max(retryAfter, 1), 30);
      console.error(`Rate limited by Apple Music API. Retrying in ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await fetch(url, init);
      if (res.status === 429) {
        throw new Error("Rate limited by Apple Music API even after retry. Try again later.");
      }
    }

    return res;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const qs = params ? `?${new URLSearchParams(params)}` : "";
    const res = await this.request("GET", `${path}${qs}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GET ${path} failed: ${res.status} ${res.statusText}` +
          (body ? `\n${body.slice(0, 200)}` : ""),
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(
        `GET ${path} returned non-JSON response (status ${res.status}). Apple Music may be experiencing issues.`,
      );
    }
  }

  async post(path: string, body?: unknown): Promise<Response> {
    const res = await this.request("POST", path, body);
    if (!res.ok && res.status !== 201 && res.status !== 202) {
      const responseBody = await res.text().catch(() => "");
      throw new Error(
        `POST ${path} failed: ${res.status} ${res.statusText}` +
          (responseBody ? `\n${responseBody.slice(0, 200)}` : ""),
      );
    }
    return res;
  }

  async delete(path: string, params?: Record<string, string>): Promise<boolean> {
    const qs = params ? `?${new URLSearchParams(params)}` : "";
    const res = await this.request("DELETE", `${path}${qs}`);
    if (res.status !== 204 && res.status !== 200) {
      const responseBody = await res.text().catch(() => "");
      throw new Error(
        `DELETE ${path} failed: ${res.status} ${res.statusText}` +
          (responseBody ? `\n${responseBody.slice(0, 200)}` : ""),
      );
    }
    return true;
  }

  async getAll<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T[]> {
    const MAX_PAGES = 500;
    const items: T[] = [];
    let url = params ? `${path}?${new URLSearchParams(params)}` : path;
    let pages = 0;

    while (url) {
      if (++pages > MAX_PAGES) {
        throw new Error(`Pagination exceeded ${MAX_PAGES} pages. Aborting to prevent infinite loop.`);
      }
      const res = await this.request("GET", url);
      if (!res.ok) {
        throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
      }
      let json: ApiResponse<T>;
      try {
        json = (await res.json()) as ApiResponse<T>;
      } catch {
        throw new Error(
          `GET ${url} returned non-JSON response (status ${res.status}). Apple Music may be experiencing issues.`,
        );
      }
      if (!Array.isArray(json.data)) {
        throw new Error(
          `GET ${url} returned unexpected response: missing "data" array.`,
        );
      }
      items.push(...json.data);
      url = json.next ?? "";
    }

    return items;
  }
}
