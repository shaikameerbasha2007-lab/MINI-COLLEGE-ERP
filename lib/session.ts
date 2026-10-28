import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getOrCreateSetting } from "./settings.js";

// Signed-cookie session and flash messages, mirroring Flask's `session` and `flash()`.

export type SessionData = { user?: string; admin?: boolean };
export type Flash = [category: string, message: string];

const SESSION_COOKIE = "session";
const FLASH_COOKIE = "flashes";

async function getSecret(): Promise<string> {
  return process.env.SESSION_SECRET || getOrCreateSetting("session_secret", () => randomBytes(32).toString("hex"));
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name: string, value: string, maxAge?: number): string {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Secure`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

export class RequestState {
  session: SessionData = {};
  private incomingFlashes: Flash[] = [];
  private newFlashes: Flash[] = [];
  private flashesConsumed = false;
  private sessionChanged = false;
  private secret = "";

  static async load(req: Request): Promise<RequestState> {
    const state = new RequestState();
    const cookies = parseCookies(req);
    const raw = cookies[SESSION_COOKIE];
    const flashRaw = cookies[FLASH_COOKIE];
    if (raw) {
      state.secret = await getSecret();
      const [payload, sig] = raw.split(".");
      const expected = sign(payload || "", state.secret);
      if (sig && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        try {
          state.session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        } catch {
          state.session = {};
        }
      }
    }
    if (flashRaw) {
      try {
        const parsed = JSON.parse(Buffer.from(flashRaw, "base64url").toString("utf8"));
        if (Array.isArray(parsed)) state.incomingFlashes = parsed;
      } catch {
        // ignore malformed flash cookie
      }
    }
    return state;
  }

  setSession(data: SessionData) {
    this.session = data;
    this.sessionChanged = true;
  }

  clearSession() {
    this.setSession({});
  }

  flash(message: string, category = "message") {
    this.newFlashes.push([category, message]);
  }

  getFlashedMessages(withCategories = false): Array<string | Flash> {
    this.flashesConsumed = true;
    return withCategories ? this.incomingFlashes : this.incomingFlashes.map(([, m]) => m);
  }

  async applyCookies(headers: Headers): Promise<void> {
    if (this.sessionChanged) {
      if (Object.keys(this.session).length === 0) {
        headers.append("set-cookie", cookie(SESSION_COOKIE, "", 0));
      } else {
        if (!this.secret) this.secret = await getSecret();
        const payload = Buffer.from(JSON.stringify(this.session)).toString("base64url");
        headers.append("set-cookie", cookie(SESSION_COOKIE, `${payload}.${sign(payload, this.secret)}`));
      }
    }
    const pending = [...(this.flashesConsumed ? [] : this.incomingFlashes), ...this.newFlashes];
    if (this.newFlashes.length > 0 || (this.flashesConsumed && this.incomingFlashes.length > 0)) {
      headers.append(
        "set-cookie",
        pending.length
          ? cookie(FLASH_COOKIE, Buffer.from(JSON.stringify(pending)).toString("base64url"))
          : cookie(FLASH_COOKIE, "", 0),
      );
    }
  }
}
