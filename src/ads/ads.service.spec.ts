import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdsService } from './ads.service';

describe('AdsService', () => {
  let adsService: AdsService;
  let prismaService: Record<string, any>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    prismaService = {
      adBanner: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      userAdBannerDismissal: {
        upsert: jest.fn(),
      },
    };

    adsService = new AdsService(prismaService as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects create when endsAt is before startsAt', async () => {
    await expect(
      adsService.create({
        title: 'Весенняя акция',
        targetUrl: 'https://example.test',
        startsAt: '2026-03-30T12:00:00.000Z',
        endsAt: '2026-03-29T12:00:00.000Z',
        repeatIntervalDays: 7,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns active banner when no dismissal exists', async () => {
    prismaService.adBanner.findMany.mockResolvedValue([
      createBanner({
        dismissals: [],
      }),
    ]);

    const result = await adsService.getActiveForUser('user-1');

    expect(result?.id).toBe('banner-1');
  });

  it('does not return banner during cooldown', async () => {
    prismaService.adBanner.findMany.mockResolvedValue([
      createBanner({
        dismissals: [{ dismissedAt: new Date('2026-03-25T12:00:00.000Z') }],
      }),
    ]);

    const result = await adsService.getActiveForUser('user-1');

    expect(result).toBeNull();
  });

  it('returns banner again after cooldown expires', async () => {
    prismaService.adBanner.findMany.mockResolvedValue([
      createBanner({
        dismissals: [{ dismissedAt: new Date('2026-03-21T12:00:00.000Z') }],
      }),
    ]);

    const result = await adsService.getActiveForUser('user-1');

    expect(result?.id).toBe('banner-1');
  });

  it('picks the first eligible banner by sort order', async () => {
    prismaService.adBanner.findMany.mockResolvedValue([
      createBanner({
        id: 'banner-1',
        sortOrder: 0,
        dismissals: [{ dismissedAt: new Date('2026-03-28T12:00:00.000Z') }],
      }),
      createBanner({
        id: 'banner-2',
        sortOrder: 1,
        dismissals: [],
      }),
    ]);

    const result = await adsService.getActiveForUser('user-1');

    expect(result?.id).toBe('banner-2');
  });

  it('stores dismissal timestamp for the banner and user', async () => {
    prismaService.adBanner.findUnique.mockResolvedValue({ id: 'banner-1' });

    const result = await adsService.dismiss('user-1', 'banner-1');

    expect(prismaService.userAdBannerDismissal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_bannerId: {
            userId: 'user-1',
            bannerId: 'banner-1',
          },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('throws when dismissing an unknown banner', async () => {
    prismaService.adBanner.findUnique.mockResolvedValue(null);

    await expect(adsService.dismiss('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function createBanner(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'banner-1',
    title: 'Весенняя акция',
    imageUrl: '/uploads/ads/banner.jpg',
    targetUrl: 'https://example.test',
    startsAt: new Date('2026-03-20T12:00:00.000Z'),
    endsAt: new Date('2026-04-20T12:00:00.000Z'),
    repeatIntervalDays: 7,
    dismissals: [],
    ...overrides,
  };
}
