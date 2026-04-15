import bytes from 'bytes';
import * as cheerio from 'cheerio';
import { NotFoundError } from '../error';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { buildMediaFlowProxyExtractorRedirectUrl, supportsMediaFlowProxy } from '../utils';
import { Extractor } from './Extractor';

export class Fembed extends Extractor {
  public readonly id = 'fembed';

  public readonly label = 'Fembed';

  public override viaMediaFlowProxy = true;

  public supports(ctx: Context, url: URL): boolean {
    return url.host.includes('fembed.sx') && supportsMediaFlowProxy(ctx);
  }

  public override readonly normalize = (url: URL): URL => {
    // Garante que a URL use o formato /e/ para embed
    let href = url.href;
    // Converte /f/ para /e/ se necessário
    href = href.replace('/f/', '/e/');
    return new URL(href);
  };

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    // Normaliza a URL para o formato de embed
    const embedUrl = this.normalize(url);
    
    // Extrai informações da URL (ID, audio, temporada, episódio)
    // Padrões: /e/<ID>-<AUDIO> ou /e/<ID>-<AUDIO>/<SEASON>-<EPISODE>
    const urlMatch = embedUrl.pathname.match(/\/e\/([^/]+?)(?:-(\w+))?(?:\/(\d+)-(\d+))?/);
    if (!urlMatch) {
      throw new NotFoundError('Invalid Fembed URL format');
    }

    const [, id, audio, season, episode] = urlMatch;
    const isSeries = !!season && !!episode;

    // Busca a página do embed para verificar disponibilidade e extrair metadados
    const html = await this.fetcher.text(ctx, embedUrl);

    // Verifica se o conteúdo existe
    if (/not found|can't find|error|unavailable/i.test(html)) {
      throw new NotFoundError();
    }

    const $ = cheerio.load(html);
    
    // Tenta extrair título da página
    let title = $('title').text().trim() || $('.title').text().trim() || meta.title;
    
    // Remove sufixos comuns do título
    title = title.replace(/ - Fembed| - Player/gi, '').trim();

    // Constrói a URL final para o proxy mantendo o -dub
    const finalUrl = buildMediaFlowProxyExtractorRedirectUrl(ctx, 'Fembed', url);

    return [
      {
        url: finalUrl,
        format: Format.hls,
        meta: {
          ...meta,
          title: title || meta.title,
          audio: audio || 'auto', // 'dub', 'leg', ou 'auto'
          ...(isSeries && {
            season: parseInt(season, 10),
            episode: parseInt(episode, 10),
          }),
        },
      },
    ];
  };
}
