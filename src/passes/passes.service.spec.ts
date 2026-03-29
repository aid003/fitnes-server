import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PassesService } from './passes.service';
import * as uploadUtils from '../common/uploads/upload.utils';

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
      passFeature: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    passesService = new PassesService(prismaService as PrismaService);
  });

  it('does not seed catalog when categories already exist', async () => {
    prismaService.passCategory.count.mockResolvedValue(1);

    await passesService.onModuleInit();

    expect(prismaService.passCategory.create).not.toHaveBeenCalled();
  });

  it('seeds full catalog when categories table is empty', async () => {
    prismaService.passCategory.count.mockResolvedValue(0);

    await passesService.onModuleInit();

    expect(prismaService.passCategory.create).toHaveBeenCalledTimes(6);

    const [firstCall] = prismaService.passCategory.create.mock.calls;
    expect(firstCall[0].data.slug).toBe('unlimited-daily');
    expect(firstCall[0].data.variants.create[0].groups.create).toHaveLength(5);
    expect(
      firstCall[0].data.variants.create[0].groups.create[0].plans.create[0].price,
    ).toBe(849000);

    const createdCategorySlugs =
      prismaService.passCategory.create.mock.calls.map(
        ([argument]: Array<{ data: { slug: string } }>) => argument.data.slug,
      );

    expect(createdCategorySlugs).toEqual([
      'unlimited-daily',
      'best-hours',
      'kids-sections',
      'adult-group-classes',
      'teen-membership',
      'personal-training',
    ]);
  });

  it('lists only active public categories ordered by sort order', async () => {
    prismaService.passCategory.findMany.mockResolvedValue([
      {
        id: 'cat-1',
        title: 'Unlimited',
        slug: 'unlimited',
        coverImageUrl: null,
        isActive: true,
        sortOrder: 0,
      },
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
                  price: 649000,
                  currency: 'RUB',
                  durationValue: 1,
                  durationUnit: 'MONTH',
                  visitCount: null,
                  billingType: 'UNLIMITED',
                  highlightStyle: null,
                  sortOrder: 0,
                  isActive: true,
                  badges: [
                    {
                      id: 'badge-1',
                      label: '+2 дня',
                      style: 'gift',
                      sortOrder: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await passesService.getPublicCategoryBySlug('unlimited');

    expect(result.slug).toBe('unlimited');
    expect(result.variants[0]?.groups[0]?.plans[0]?.price).toBe(6490);
    expect(result.variants[0]?.groups[0]?.plans[0]?.badges[0]?.label).toBe(
      '+2 дня',
    );
  });

  it('stores admin-entered plan prices in kopecks', async () => {
    prismaService.passPlanGroup.findUnique.mockResolvedValue({
      id: 'group-1',
      variant: {
        categoryId: 'category-1',
      },
    });
    prismaService.passPlan.create.mockResolvedValue({});
    prismaService.passCategory.findUnique.mockResolvedValue({
      id: 'category-1',
      title: 'Unlimited',
      slug: 'unlimited',
      description: null,
      coverImageUrl: '/buy/image1.jpg',
      sortOrder: 0,
      isActive: true,
      variants: [],
    });

    await passesService.createPlan('group-1', {
      title: '1 month',
      slug: '1-month',
      price: 8490,
      currency: 'RUB',
    });

    expect(prismaService.passPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          price: 849000,
        }),
      }),
    );
  });

  it('rejects update when category does not exist', async () => {
    prismaService.passCategory.findUnique.mockResolvedValue(null);

    await expect(
      passesService.updateCategory('missing', {
        title: 'Updated',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('replaces category cover and removes previous uploaded file', async () => {
    const deleteUploadedFileSpy = jest
      .spyOn(uploadUtils, 'deleteUploadedFile')
      .mockResolvedValue(undefined);

    prismaService.passCategory.findUnique
      .mockResolvedValueOnce({
        coverImageUrl: '/uploads/passes/old-cover.jpg',
      })
      .mockResolvedValueOnce({
        id: 'category-1',
        title: 'Unlimited',
        slug: 'unlimited',
        description: null,
        coverImageUrl: '/uploads/passes/new-cover.jpg',
        sortOrder: 0,
        isActive: true,
        variants: [],
      });
    prismaService.passCategory.update.mockResolvedValue({});

    const result = await passesService.updateCategoryCover(
      'category-1',
      '/uploads/passes/new-cover.jpg',
    );

    expect(prismaService.passCategory.update).toHaveBeenCalledWith({
      where: { id: 'category-1' },
      data: { coverImageUrl: '/uploads/passes/new-cover.jpg' },
    });
    expect(deleteUploadedFileSpy).toHaveBeenCalledWith(
      '/uploads/passes/old-cover.jpg',
    );
    expect(result.coverImageUrl).toBe('/uploads/passes/new-cover.jpg');
  });

  it('removes category cover and deletes uploaded file', async () => {
    const deleteUploadedFileSpy = jest
      .spyOn(uploadUtils, 'deleteUploadedFile')
      .mockResolvedValue(undefined);

    prismaService.passCategory.findUnique
      .mockResolvedValueOnce({
        coverImageUrl: '/uploads/passes/cover.jpg',
      })
      .mockResolvedValueOnce({
        id: 'category-1',
        title: 'Unlimited',
        slug: 'unlimited',
        description: null,
        coverImageUrl: null,
        sortOrder: 0,
        isActive: true,
        variants: [],
      });
    prismaService.passCategory.update.mockResolvedValue({});

    const result = await passesService.removeCategoryCover('category-1');

    expect(prismaService.passCategory.update).toHaveBeenCalledWith({
      where: { id: 'category-1' },
      data: { coverImageUrl: null },
    });
    expect(deleteUploadedFileSpy).toHaveBeenCalledWith(
      '/uploads/passes/cover.jpg',
    );
    expect(result.coverImageUrl).toBeNull();
  });
});
