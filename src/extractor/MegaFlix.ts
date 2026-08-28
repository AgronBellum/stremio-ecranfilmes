import { Context, Meta } from '../types';
import { Fetcher } from '../utils';
import { Source } from './Source';

export class MegaFlixSource extends Source {
  public readonly id = 'megaflix';
  public readonly label = 'MegaFlix (Dublados)';
  public readonly baseUrl = 'https://megafrixapi.com';

  constructor(protected readonly fetcher: Fetcher) {
    super();
  }

  public async getStreams(ctx: Context, meta: Meta): Promise<string[]> {
    try {
      // 1. Busca metadados limpos usando a API oficial do Cinemeta v3 (igual ao Stremio)
      const title = await this.getMetaDetails(ctx, meta);
      if (!title) return [];

      // 2. Pesquisa o item no MegaFlix
      const itemId = await this.searchMegaFlixItem(ctx, title, meta.year ? String(meta.year) : '', meta.isSeries);
      if (!itemId) return [];

      const embedUrls: string[] = [];

      // 3. Extrai os links dos episódios (série) ou do filme
      if (meta.isSeries && meta.season && meta.episode) {
        const epUrl = `${this.baseUrl}/desktop/1.2.2/?page=getEpisodes&season=${meta.season}&idItem=${itemId}`;
        const html = await this.fetcher.text(ctx, new URL(epUrl), {
          method: 'POST',
          body: 'userEpisodes=[]',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://megaflix.name/',
            'Origin': 'https://megaflix.name',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          }
        }).catch(() => '');

        const episodeBlockRegex = /openEpisode\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
        let match;
        while ((match = episodeBlockRegex.exec(html)) !== null) {
          const block = match[1];
          const epNumMatch = block.match(/episode_num\s*:\s*["']?(\d+)["']?/);
          if (epNumMatch && parseInt(epNumMatch[1], 10) === Number(meta.episode)) {
            const brMatch = block.match(/br\s*:\s*["']([^"']+)["']/)?.[1] || '';
            brMatch.split(',').forEach(u => {
              let finalUrl = u.trim();
              if (finalUrl) {
                if (finalUrl.includes('cnvs') && !finalUrl.startsWith('http')) {
                  finalUrl = `${this.baseUrl}/cnvs/` + encodeURIComponent(finalUrl);
                }
                embedUrls.push(finalUrl);
              }
            });
          }
        }
      } else {
        const viewUrl = `${this.baseUrl}/desktop/1.2.2/?page=viewItem&id=${itemId}`;
        const html = await this.fetcher.text(ctx, new URL(viewUrl), {
          headers: { 'Referer': `${this.baseUrl}/`, 'User-Agent': 'Mozilla/5.0' }
        }).catch(() => '');
        
        const optionsMatch = html.match(/openOptions\s*\(\s*\{([\s\S]*?)\}\s*\)/);
        const brGroup = optionsMatch?.[1]?.match(/br:\s*['"]([^'"]*)['"]/)?.[1] || '';
        brGroup.split(',').forEach(u => {
          let finalUrl = u.trim();
          if (finalUrl) {
            if (finalUrl.includes('cnvs') && !finalUrl.startsWith('http')) {
              finalUrl = `${this.baseUrl}/cnvs/` + encodeURIComponent(finalUrl);
            }
            embedUrls.push(finalUrl);
          }
        });
      }

      return embedUrls;
    } catch {
      return [];
    }
  }

  private async getMetaDetails(ctx: Context, meta: Meta): Promise<string | null> {
    const imdbId = meta.imdbId;
    if (!imdbId) return null;
    const type = meta.isSeries ? 'series' : 'movie';
    try {
      const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
      const response = await this.fetcher.json(ctx, new URL(url)) as { meta?: { name?: string } };
      return response?.meta?.name || null;
    } catch {
      return null;
    }
  }

  private async searchMegaFlixItem(ctx: Context, title: string, year: string, isSeries?: boolean): Promise<string | null> {
    const encoded = encodeURIComponent(title.trim());
    const urls = [
      `${this.baseUrl}/desktop/1.2.2/?page=searchItem&title=${encoded}`,
      `${this.baseUrl}/desktop/1.2.1/?page=searchItem&title=${encoded}`
    ];

    for (const url of urls) {
      try {
        const html = await this.fetcher.text(ctx, new URL(url), {
          headers: { 'Referer': `${this.baseUrl}/`, 'User-Agent': 'Mozilla/5.0' }
        });
        if (!html) continue;

        // Extrai ID do item do HTML usando regex rápida
        const itemRegex = /openItem\s*\(\s*(\d+)\s*\)[^>]*?>\s*<h3[^>]*>([^<]+)<\/h3>/g;
        let match;
        while ((match = itemRegex.exec(html)) !== null) {
          const id = match[1];
          const itemTitle = match[2].trim();
          if (this.normalizeTitle(itemTitle) === this.normalizeTitle(title)) {
            return id;
          }
        }
        
        // Fallback: se achar pelo menos um card correspondente ao tipo
        const firstIdMatch = html.match(/openItem\s*\(\s*(\d+)\s*\)/);
        if (firstIdMatch?.[1]) return firstIdMatch[1];
      } catch {}
    }
    return null;
  }

  private normalizeTitle(value: string): string {
    if (!value) return '';
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
  }
}
