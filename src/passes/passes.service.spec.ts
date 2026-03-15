import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassesService } from './passes.service';

describe('PassesService', () => {
  let passesService: PassesService;
  let prismaService: Record<string, any>;

  beforeEach(() => {
    prismaService = {
      passCategory: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      passVariant: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      passPlanGroup: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      passPlan: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      passBadge: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    passesService = new PassesService(prismaService as PrismaService);
  });

  it('lists only active public categories ordered by sort order', async () => {
    prismaService.passCategory.findMany.mockResolvedValue([
      { id: 'cat-1', title: 'Unlimited', slug: 'unlimited', coverImageUrl: null, isActive: true, sortOrder: 0 },
    ]);

    const result = await passesService.listPublicCategories();

    expect(prismaService.passCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
      }),
    );
    expect(result).toHaveLength(1);
  });

  it('returns full category details for public page', async () => {
    prismaService.passCategory.findFirst.mockResolvedValue({
      id: 'cat-1',
      title: 'Unlimited',
      slug: 'unlimited',
      description: null,
      coverImageUrl: '/buy/image1.jpg',
      sortOrder: 0,
      isActive: true,
      variants: [
        {
          id: 'variant-1',
          title: 'All access',
          slug: 'all-access',
          description: null,
          sortOrder: 0,
          isActive: true,
          groups: [
            {
              id: 'group-1',
              title: 'Short term',
              slug: 'short-term',
              description: null,
              sortOrder: 0,
              isActive: true,
              plans: [
                {
                  id: 'plan-1',
                  title: '1 month',
                  slug: '1-month',
                  description: null,
                  subtitle: null,
                  price: 6490,
                  currency: 'RUB',
                  durationValue: 1,
                  durationUnit: 'MONTH',
                  visitCount: null,
                  billingType: 'UNLIMITED',
                  highlightStyle: null,
                  sortOrder: 0,
                  isActive: true,
                  badges: [{ id: 'badge-1', label: '+2 дня', style: 'gift', sortOrder: 0 }],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await passesService.getPublicCategoryBySlug('unlimited');

    expect(result.slug).toBe('unlimited');
    expect(result.variants[0]?.groups[0]?.plans[0]?.badges[0]?.label).toBe('+2 дня');
  });

  it('rejects update when category does not exist', async () => {
    prismaService.passCategory.findUnique.mockResolvedValue(null);

    await expect(
      passesService.updateCategory('missing', {
        title: 'Updated',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
