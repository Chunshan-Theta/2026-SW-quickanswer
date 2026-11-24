/**
 * Minimal browser-like cookie jar shared by every "tab" of one browser profile:
 * stores Set-Cookie responses and replays them as one Cookie header.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }

  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = value === "" || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** Every `Set-Cookie` of a response as `{ name, value, attributes }`. */
export function setCookies(response: Response) {
  return response.headers.getSetCookie().map((header) => {
    const [pair, ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    return { name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim(), attributes: attributes.map((attribute) => attribute.trim().toLowerCase()) };
  });
}
