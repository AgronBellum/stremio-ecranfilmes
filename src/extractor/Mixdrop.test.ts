import winston from 'winston';
import { createTestContext } from '../test';
import { FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { Mixdrop } from './Mixdrop';


const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new Fembed(new FetcherMock(`${__dirname}/__fixtures__/Fembed`))]);

const ctx = createTestContext({ mediaFlowProxyUrl: 'https://mediaflow-proxy.test', mediaFlowProxyPassword: 'asdfg' });

describe('Fembed', () => {
  test('fembed.sx filme dublado', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://fembed.sx/e/671-dub'))).toMatchSnapshot();
  });

  test('fembed.sx série dublada', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://fembed.sx/e/94997-dub/1-7'))).toMatchSnapshot();
  });

  test('fembed.sx com IMDB', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://fembed.sx/e/tt0241527-dub'))).toMatchSnapshot();
  });

  test('not found', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://fembed.sx/e/999999999-dub'))).toMatchSnapshot();
  });
});

