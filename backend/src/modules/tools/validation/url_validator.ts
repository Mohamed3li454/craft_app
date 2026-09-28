/**
 * URL Security & SSRF Protection Validator (Phase 8.2)
 *
 * Enforces strict destination safety for network tools:
 * - Rejects loopback (localhost, 127.0.0.1, ::1)
 * - Rejects link-local and cloud metadata endpoints (169.254.169.254)
 * - Rejects private RFC 1918 address ranges (10.x, 172.16-31.x, 192.168.x)
 * - Rejects carrier-grade NAT (100.64.0.0/10)
 * - Restricts protocols to HTTP / HTTPS only
 * - Rejects userinfo tricks, CRLF, and malformed encoding
 */

export interface UrlValidationResult {
  readonly isValid: boolean;
  readonly sanitizedUrl?: string;
  readonly error?: string;
  readonly isSsrf?: boolean;
}

const CLOUD_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
]);

export class UrlSecurityValidator {
  /**
   * Validates a target URL against SSRF and network isolation policies.
   */
  public static validate(urlString: string | null | undefined): UrlValidationResult {
    if (!urlString || typeof urlString !== 'string') {
      return { isValid: false, error: 'Empty or invalid URL input' };
    }

    const trimmed = urlString.trim();

    // Check for null bytes and CRLF injection attempts
    if (trimmed.includes('\u0000') || /[\r\n]/.test(trimmed)) {
      return { isValid: false, error: 'URL contains illegal control characters', isSsrf: true };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { isValid: false, error: 'Malformed URL structure' };
    }

    // 1. Protocol Restriction: strictly http or https
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        isValid: false,
        error: `Unsupported URL protocol: "${protocol}". Only http and https are allowed.`,
        isSsrf: true,
      };
    }

    // 2. Reject credentials embedded in URL (e.g. http://user:pass@host)
    if (parsed.username || parsed.password) {
      return {
        isValid: false,
        error: 'URLs containing embedded authentication credentials are not permitted',
        isSsrf: true,
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // 3. Reject empty hostname or trailing dot evasion
    if (!hostname) {
      return { isValid: false, error: 'Missing hostname in URL', isSsrf: true };
    }

    // 4. Cloud Metadata Hostnames
    if (CLOUD_METADATA_HOSTS.has(hostname) || hostname.endsWith('.internal')) {
      return {
        isValid: false,
        error: `Access to internal cloud metadata service (${hostname}) is strictly forbidden`,
        isSsrf: true,
      };
    }

    // 5. Loopback hostnames
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return {
        isValid: false,
        error: `Access to loopback interface (${hostname}) is forbidden`,
        isSsrf: true,
      };
    }

    // 6. IPv4 Address Checks
    if (this.isIpv4Address(hostname)) {
      if (this.isPrivateOrRestrictedIpv4(hostname)) {
        return {
          isValid: false,
          error: `Access to private or restricted IP address (${hostname}) is forbidden`,
          isSsrf: true,
        };
      }
    }

    // 7. IPv6 Address Checks
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      const ipv6 = hostname.slice(1, -1);
      if (this.isPrivateOrRestrictedIpv6(ipv6)) {
        return {
          isValid: false,
          error: `Access to private or restricted IPv6 address (${hostname}) is forbidden`,
          isSsrf: true,
        };
      }
    }

    return {
      isValid: true,
      sanitizedUrl: parsed.toString(),
    };
  }

  /**
   * Fast boolean check for external URL validity.
   */
  public static isSafePublicUrl(urlString: string | null | undefined): boolean {
    return this.validate(urlString).isValid;
  }

  private static isIpv4Address(host: string): boolean {
    const parts = host.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      const n = Number(p);
      return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
    });
  }

  private static isPrivateOrRestrictedIpv4(ip: string): boolean {
    const octets = ip.split('.').map(Number);
    const [o1, o2] = octets;

    // 127.0.0.0/8 (Loopback)
    if (o1 === 127) return true;

    // 0.0.0.0/8 (Current network)
    if (o1 === 0) return true;

    // 10.0.0.0/8 (Private RFC 1918)
    if (o1 === 10) return true;

    // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 to 172.31.255.255)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;

    // 192.168.0.0/16 (Private RFC 1918)
    if (o1 === 192 && o2 === 168) return true;

    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (o1 === 169 && o2 === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT: 100.64.0.0 to 100.127.255.255)
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (o1 >= 224) return true;

    return false;
  }

  private static isPrivateOrRestrictedIpv6(ipv6: string): boolean {
    const lower = ipv6.toLowerCase();

    // ::1 (Loopback) or :: (Unspecified)
    if (lower === '::1' || lower === '::') return true;

    // fe80::/10 (Link-local unicast)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }

    // fc00::/7 (Unique local address: fc00:: or fd00::)
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }

    // IPv4-mapped IPv6 (::ffff:127.0.0.1, etc.)
    if (lower.startsWith('::ffff:')) {
      const v4Part = lower.replace('::ffff:', '');
      if (this.isIpv4Address(v4Part)) {
        return this.isPrivateOrRestrictedIpv4(v4Part);
      }
    }

    return false;
  }
}
