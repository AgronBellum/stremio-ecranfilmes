import { NotFoundError } from '../error';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { Extractor } from './Extractor';
import * as cheerio from 'cheerio';
import { URL } from 'url';

export class ClickHost extends Extractor {
  public readonly id = 'clickhost';
  public readonly label = 'ClickHost';
  public override readonly ttl: number = 21600000; // 6h

  private readonly mainUrl = 'https://embed-api.clickhost.xyz';

  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  public supports(_ctx: Context, url: URL): boolean {
    const allowed = ['clickhost.xyz', 'embed-api.clickhost.xyz'];
    return allowed.some(domain => url.host.includes(domain));
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const targetUrl = url.toString();
    const headers = {
      'User-Agent': this.userAgent,
      'Referer': targetUrl,
      'Origin': this.mainUrl,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    };

    let serverId = url.searchParams.get('server_id');

    // Se o ID do servidor não veio na URL, buscamos na página HTML
    if (!serverId) {
      const html = await this.fetcher.text(ctx, new URL(targetUrl), { headers }).catch(() => '');
      if (html) {
        const serversJson = this.extractServersJson(html);
        serverId = this.extractFirstServerId(serversJson);
      }
    }

    if (!serverId) {
      throw new NotFoundError();
    }

    // Chamada ao endpoint /init da API do ClickHost
    const initUrl = `${this.mainUrl}/embed/stream/${serverId}/init`;
    const initHeaders = {
      'User-Agent': this.userAgent,
      'Referer': targetUrl,
      'Origin': this.mainUrl,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    };

    let initResponseText: string;
    try {
      initResponseText = await this.fetcher.text(ctx, new URL(initUrl), {
        method: 'POST',
        headers: initHeaders,
        body: '{}',
      } as any);
    } catch {
      throw new NotFoundError();
    }

    let json: any;
    try {
      json = JSON.parse(initResponseText);
    } catch {
      throw new NotFoundError();
    }

    if (!json || !json.ok) {
      throw new NotFoundError();
    }

    const returnedUrl = json.url || json.src || json.source || json.file || json.stream;
    if (!returnedUrl || typeof returnedUrl !== 'string') {
      throw new NotFoundError();
    }

    const streamUrl = this.resolveUrl(this.mainUrl, returnedUrl);
    const isHls = json.is_hls || streamUrl.includes('.m3u8');
    const format = isHls ? Format.hls : Format.mp4;

    return [
      {
        url: new URL(streamUrl),
        format: format,
        meta: {
          ...meta,
        },
      },
    ];
  }

  private extractServersJson(html: string): string | null {
    const declarationRegex = /(?:const|let|var)?\s*servers\s*=/i;
    const match = html.match(declarationRegex);
    if (!match || match.index === undefined) return null;

    const start = html.indexOf('[', match.index + match[0].length);
    if (start < 0) return null;

    return this.extractBalancedArray(html, start);
  }

  private extractBalancedArray(text: string, start: number): string | null {
    if (start < 0 || start >= text.length || text[start] !== '[') return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let quoteChar = '\u0000';

    for (let index = start; index < text.length; index++) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === quoteChar) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        quoteChar = char;
        continue;
      }

      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          return text.substring(start, index + 1);
        }
      }
    }

    return null;
  }

  private extractFirstServerId(serversJson: string | null): string | null {
    if (!serversJson) return null;
    try {
      const array = JSON.parse(serversJson);
      if (!Array.isArray(array) || array.length === 0) return null;
      const firstServer = array[0];
      const id = firstServer?.id ? String(firstServer.id).trim() : null;
      return id || null;
    } catch {
      return null;
    }
  }

  private resolveUrl(baseUrl: string, value: string): string {
    const url = value.trim();
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return baseUrl.replace(/\/+$/, '') + (url.startsWith('/') ? '' : '/') + url;
    }
  }
}
