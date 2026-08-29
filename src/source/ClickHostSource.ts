import { ContentType } from 'stremio-addon-sdk';
import { Context, CountryCode } from '../types';
import { Fetcher, getTmdbId, getTmdbNameAndYear, Id } from '../utils';
import { Source, SourceResult } from './Source';

export class ClickHostSource extends Source {
  public readonly id = 'clickhost';
  public readonly label = 'ClickHost';
  public readonly contentTypes: ContentType[] = ['movie', 'series'];
  public readonly countryCodes: CountryCode[] = [CountryCode.multi, CountryCode.br];
  public readonly baseUrl = 'https://embed-api.clickhost.xyz';
  public override readonly priority = 1;

  private readonly fetcher: Fetcher;

  public constructor(fetcher: Fetcher) {
    super();
    this.fetcher = fetcher;
  }

  public async handleInternal(ctx: Context, _type: string, id: Id): Promise<SourceResult[]> {
    const tmdbId = await getTmdbId(ctx, this.fetcher, id);
    const [name, year] = await getTmdbNameAndYear(ctx, this.fetcher, tmdbId);

    let title: string = name;
    let embedPath: string;

    if (tmdbId.season) {
      title += ` ${tmdbId.formatSeasonAndEpisode()}`;
      embedPath = `/embed/serie/${tmdbId.id}/${tmdbId.season}/${tmdbId.episode}`;
    } else {
      title += ` (${year})`;
      embedPath = `/embed/filme/${tmdbId.id}`;
    }

    const url = new URL(embedPath, this.baseUrl);
    url.searchParams.set('ad_played', '1');
    url.searchParams.set('player', 'v2');

    return [
      {
        url,
        meta: {
          title: `ClickHost - ${title}`,
        },
      },
    ];
  }
}