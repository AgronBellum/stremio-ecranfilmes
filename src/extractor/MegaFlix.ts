import { NotFoundError } from '../error';
import { Context, CountryCode, Format, InternalUrlResult, Meta } from '../types';
import { guessHeightFromPlaylist, hasMultiEnabled } from '../utils';
import { Extractor } from './Extractor';
import * as cheerio from 'cheerio';
import { URL } from 'url';

export class MegaFlix extends Extractor {
  public readonly id = 'megaflix';
  public readonly label = 'MegaFlix';
  public override readonly ttl: number = 21600000; // 6h

  private readonly mainUrl = 'https://megafrixapi.com';

  public supports(_ctx: Context, url: URL): boolean {
    const allowed = [
      'megaflix', 'megafrixapi', 'faz-o-eli', 'luluvdo', 'playerwish', 'streamwish',
      'filemoon', 'filemolson', 'streamtape', 'doodstream', 'mixdrop', 'voe', 'embedplay',
      'vod07e001', 'vod07', 'vod', 'fun', 'hidehide', 'hide', 'listeamed', 'voltz', 'cnvs',
      'vidara', 'upbolt', 'futureengineering', 'softwaredownloadhub', 'acek-cdn', 'tnmr.org',
      'lulucdn', 'lulustream', 'shop', 'site'
    ];
    return allowed.some(domain => url.host.includes(domain));
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const headers = {
      'Referer': `${this.mainUrl}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };

    let targetUrl = url.toString();
    const decodedPlayer = this.tryDecodePlayerLink(targetUrl);
    if (decodedPlayer) {
      targetUrl = decodedPlayer;
    }

    const resolvedUrl = await this.resolveMegaFlixWrapper(ctx, targetUrl, headers);
    const finalStreamUrl = await this.resolveStreamUrl(ctx, resolvedUrl, headers);

    if (!finalStreamUrl) {
      throw new NotFoundError();
    }

    const playlistUrl = new URL(finalStreamUrl);
    const countryCodes = meta.countryCodes ?? [CountryCode.multi];

    if (!hasMultiEnabled(ctx.config) && !countryCodes.some(countryCode => countryCode in ctx.config)) {
      return [];
    }

    return [
      {
        url: playlistUrl,
        format: Format.hls,
        meta: {
          ...meta,
          countryCodes,
          height: meta.height ?? await guessHeightFromPlaylist(ctx, this.fetcher, playlistUrl, { headers }),
        },
      },
    ];
  }

  private tryDecodePlayerLink(url: string): string | null {
    if (!url.includes('megafrixapi.com/desktop/player') || !url.includes('link=')) return null;
    const rawLink = url.substringAfter('link=').substringBefore('&');
    if (!rawLink) return null;
    try {
      const decoded = Buffer.from(rawLink, 'base64').toString('utf-8').trim();
      return decoded.startsWith('http') ? decoded : null;
    } catch {
      return null;
    }
  }

  private async resolveMegaFlixWrapper(ctx: Context, url: string, headers: Record<string, string>): Promise<string> {
    let currentUrl = url;

    if (currentUrl.includes('/cnvs/')) {
      const encodedPart = currentUrl.substringAfter('/cnvs/');
      currentUrl = decodeURIComponent(encodedPart);
      if (this.isStrictMediaUrl(currentUrl)) return currentUrl;
    }

    if (currentUrl.includes('/hide/') || currentUrl.includes('megafrixapi.com/hide/')) {
      const hideId = currentUrl.split('/').pop() || '';
      const hideUrl = `https://hidehide.shop/v/${hideId}`;
      try {
        const html = await this.fetcher.text(ctx, new URL(hideUrl), { headers: { ...headers, 'Referer': 'https://hidehide.shop/' } });
        const $ = cheerio.load(html);
        const iframeSrc = $('iframe[src]').attr('src');
        if (iframeSrc) {
          return iframeSrc.startsWith('//') ? `https:${iframeSrc}` : iframeSrc;
        }
      } catch {
        // Ignora
      }
      return hideUrl;
    }

    return currentUrl;
  }

  private async resolveStreamUrl(ctx: Context, targetUrl: string, headers: Record<string, string>): Promise<string | null> {
    if (this.isStrictMediaUrl(targetUrl)) return targetUrl;

    if (targetUrl.includes('hidehide') || targetUrl.includes('hide')) {
      return this.extractHideHide(ctx, targetUrl, headers);
    } else if (targetUrl.includes('vidara')) {
      return this.extractVidara(ctx, targetUrl, headers);
    } else if (
      targetUrl.includes('upbolt') || targetUrl.includes('luluvdo') ||
      targetUrl.includes('playerwish') || targetUrl.includes('streamwish') ||
      targetUrl.includes('filemoon') || targetUrl.includes('filemolson')
    ) {
      return this.extractPackedHost(ctx, targetUrl, headers);
    } else if (targetUrl.includes('voe')) {
      return this.extractVoe(ctx, targetUrl, headers);
    } else if (targetUrl.includes('mixdrop')) {
      return this.extractMixdrop(ctx, targetUrl, headers);
    }

    return this.extractGenericHost(ctx, targetUrl, headers);
  }

  private async extractHideHide(ctx: Context, targetUrl: string, headers: Record<string, string>): Promise<string | null> {
    const hideId = targetUrl.split('/').pop() || '';
    const realPlayerUrl = targetUrl.includes('hidehide.shop') ? targetUrl : `https://hidehide.shop/v/${hideId}`;
    const html = await this.fetcher.text(ctx, new URL(realPlayerUrl), { headers: { ...headers, 'Referer': 'https://hidehide.shop/' } }).catch(() => '');
    if (!html) return null;

    const $ = cheerio.load(html);
    const iframeSrc = $('iframe[src]').attr('src');
    if (iframeSrc) {
      const innerUrl = iframeSrc.startsWith('//') ? `https:${iframeSrc}` : iframeSrc;
      return this.resolveStreamUrl(ctx, innerUrl, headers);
    }

    return this.extractPackedScript(ctx, html, 'https://hidehide.shop/', headers);
  }

  private async extractVidara(ctx: Context, url: string, headers: Record<string, string>): Promise<string | null> {
    const html = await this.fetcher.text(ctx, new URL(url), { headers }).catch(() => '');
    if (!html) return null;

    const directMatch = html.match(/(?:file|source|src)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt)[^"']*)["']/i);
    if (directMatch?.[1]) return directMatch[1];

    const base64Matches = html.matchAll(/atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/g);
    for (const match of base64Matches) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
      if (decoded.includes('.m3u8') || decoded.includes('.txt')) {
        const extracted = decoded.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|txt)[^\s"'<>]*/)?.[0];
        if (extracted) return extracted;
      }
    }

    return this.extractPackedScript(ctx, html, url, headers);
  }

  private async extractPackedHost(ctx: Context, url: string, headers: Record<string, string>): Promise<string | null> {
    const html = await this.fetcher.text(ctx, new URL(url), { headers }).catch(() => '');
    if (!html) return null;

    const $ = cheerio.load(html);
    const iframeSrc = $('iframe[src]').attr('src');
    if (iframeSrc) {
      const innerUrl = iframeSrc.startsWith('//') ? `https:${iframeSrc}` : iframeSrc;
      return this.resolveStreamUrl(ctx, innerUrl, headers);
    }

    return this.extractPackedScript(ctx, html, url, headers);
  }

  private async extractPackedScript(ctx: Context, html: string, referer: string, headers: Record<string, string>): Promise<string | null> {
    const cleanHtml = html.replace(/\\\//g, '/');
    const evalMatch = cleanHtml.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d\).*?)\s*<\/script>/s);

    if (evalMatch?.[1]) {
      const moonResult = await this.extractViaMoonPhp(ctx, evalMatch[1], referer, headers);
      if (moonResult) return moonResult;
    }

    const structuredMatch = cleanHtml.match(/(?:file|source|src|hls|video_url)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i);
    if (structuredMatch?.[1]) return structuredMatch[1];

    const rawMatch = cleanHtml.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|txt)[^\s"'<>]*/i)?.[0];
    return rawMatch && this.isStrictMediaUrl(rawMatch) ? rawMatch : null;
  }

  private async extractViaMoonPhp(ctx: Context, packedJs: string, referer: string, headers: Record<string, string>): Promise<string | null> {
    try {
      const b64Data = Buffer.from(packedJs || '', 'utf-8').toString('base64');
      const origin = new URL(referer).origin;
      const res = await this.fetcher.text(ctx, new URL('https://app.megafrixapi.com/moon.php'), {
        headers: {
          ...headers,
          'Referer': referer,
          'Origin': origin,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        data: `data=${encodeURIComponent(b64Data)}`,
      } as any);

      const fileMatch = typeof res === 'string' ? res.match(/file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|txt|mp4)[^"']*)["']/i) : null;
      return fileMatch?.[1] || null;
    } catch {
      return null;
    }
  }

  private async extractVoe(ctx: Context, url: string, headers: Record<string, string>): Promise<string | null> {
    const html = await this.fetcher.text(ctx, new URL(url), { headers }).catch(() => '');
    const hlsMatch = html.match(/'hls'\s*:\s*['"](https?:\/?[^'"]+)['"]/);
    if (hlsMatch?.[1]) return hlsMatch[1];
    return this.extractPackedScript(ctx, html, url, headers);
  }

  private async extractMixdrop(ctx: Context, url: string, headers: Record<string, string>): Promise<string | null> {
    const html = await this.fetcher.text(ctx, new URL(url), { headers }).catch(() => '');
    const mixdropMatch = html.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
    if (mixdropMatch?.[1]) {
      const it = mixdropMatch[1];
      return it.startsWith('//') ? `https:${it}` : it;
    }
    return null;
  }

  private async extractGenericHost(ctx: Context, url: string, headers: Record<string, string>): Promise<string | null> {
    const html = await this.fetcher.text(ctx, new URL(url), { headers }).catch(() => '');
    if (!html) return null;
    return this.extractPackedScript(ctx, html, url, headers);
  }

  private isStrictMediaUrl(url: string): boolean {
    if (!url) return false;
    const clean = url.replace(/\\\//g, '/').trim().toLowerCase();
    if (
      clean.includes('google-analytics') || clean.includes('googletagmanager') ||
      clean.includes('facebook') || clean.includes('adsystem') ||
      clean.includes('doubleclick') || clean.includes('cdn-cgi') ||
      clean.includes('.ts') || clean.includes('.m4s') || clean.includes('.css') ||
      (clean.includes('.js') && !clean.includes('m3u8'))
    ) {
      return false;
    }
    return (
      clean.includes('.m3u8') || clean.includes('.mp4') || clean.includes('.mpd') ||
      clean.includes('master.txt') || clean.includes('.urlset') ||
      clean.includes('master.m3u8') || clean.includes('index.m3u8') ||
      clean.includes('playlist.m3u8') || clean.includes('/hls/') ||
      clean.includes('/hls2/') || clean.includes('/hls3/')
    );
  }
}

declare global {
  interface String {
    substringAfter(delimiter: string): string;
    substringBefore(delimiter: string): string;
  }
}

String.prototype.substringAfter = function(delimiter: string): string {
  const index = this.indexOf(delimiter);
  return index === -1 ? '' : this.substring(index + delimiter.length);
};

String.prototype.substringBefore = function(delimiter: string): string {
  const index = this.indexOf(delimiter);
  return index === -1 ? this.toString() : this.substring(0, index);
};
