import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  BillingType,
  DurationUnit,
  PassFeatureIcon,
  Prisma,
} from '@prisma/client';
import {
  kopecksToRubles,
  rublesToKopecks,
} from '../common/money/money';
import { handlePrismaError } from '../common/database/prisma-errors';
import { deleteUploadedFile } from '../common/uploads/upload.utils';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePassBadgeDto } from './dto/create-pass-badge.dto';
import { CreatePassCategoryDto } from './dto/create-pass-category.dto';
import { CreatePassFeatureDto } from './dto/create-pass-feature.dto';
import { CreatePassPlanGroupDto } from './dto/create-pass-plan-group.dto';
import { CreatePassPlanDto } from './dto/create-pass-plan.dto';
import { CreatePassVariantDto } from './dto/create-pass-variant.dto';
import { UpdatePassBadgeDto } from './dto/update-pass-badge.dto';
import { UpdatePassCategoryDto } from './dto/update-pass-category.dto';
import { UpdatePassFeatureDto } from './dto/update-pass-feature.dto';
import { UpdatePassPlanGroupDto } from './dto/update-pass-plan-group.dto';
import { UpdatePassPlanDto } from './dto/update-pass-plan.dto';
import { UpdatePassVariantDto } from './dto/update-pass-variant.dto';

const passBadgeSelect = {
  id: true,
  label: true,
  style: true,
  sortOrder: true,
} satisfies Prisma.PassBadgeSelect;

const passPlanSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  subtitle: true,
  price: true,
  currency: true,
  durationValue: true,
  durationUnit: true,
  visitCount: true,
  billingType: true,
  highlightStyle: true,
  sortOrder: true,
  isActive: true,
  badges: {
    select: passBadgeSelect,
    orderBy: { sortOrder: 'asc' },
  },
  features: {
    select: {
      id: true,
      label: true,
      icon: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.PassPlanSelect;

const passPlanGroupSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  sortOrder: true,
  isActive: true,
  plans: {
    select: passPlanSelect,
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.PassPlanGroupSelect;

const passVariantSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  sortOrder: true,
  isActive: true,
  groups: {
    select: passPlanGroupSelect,
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.PassVariantSelect;

const passCategorySelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  coverImageUrl: true,
  sortOrder: true,
  isActive: true,
  variants: {
    select: passVariantSelect,
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.PassCategorySelect;

const passCategoryListSelect = {
  id: true,
  title: true,
  slug: true,
  coverImageUrl: true,
  isActive: true,
  sortOrder: true,
} satisfies Prisma.PassCategorySelect;

export type PassCategoryListItem = Prisma.PassCategoryGetPayload<{
  select: typeof passCategoryListSelect;
}>;

export type PassCategoryDetails = Prisma.PassCategoryGetPayload<{
  select: typeof passCategorySelect;
}>;

@Injectable()
export class PassesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedInitialCatalog();
    } catch {
      // Database may be unavailable during bootstrap or tests.
    }
  }

  async listPublicCategories(): Promise<PassCategoryListItem[]> {
    return this.prisma.passCategory.findMany({
      where: { isActive: true },
      select: passCategoryListSelect,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getPublicCategoryBySlug(slug: string): Promise<PassCategoryDetails> {
    const category = await this.prisma.passCategory.findFirst({
      where: { slug, isActive: true },
      select: {
        ...passCategorySelect,
        variants: {
          ...passCategorySelect.variants,
          where: { isActive: true },
          select: {
            ...passVariantSelect,
            groups: {
              ...passVariantSelect.groups,
              where: { isActive: true },
              select: {
                ...passPlanGroupSelect,
                plans: {
                  ...passPlanGroupSelect.plans,
                  where: { isActive: true },
                  select: {
                    ...passPlanSelect,
                    badges: {
                      ...passPlanSelect.badges,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Pass category not found');
    }

    return mapCategoryPricesToRubles(category);
  }

  async listAdminCategories(): Promise<PassCategoryDetails[]> {
    const categories = await this.prisma.passCategory.findMany({
      select: passCategorySelect,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return categories.map(mapCategoryPricesToRubles);
  }

  async createCategory(
    dto: CreatePassCategoryDto,
  ): Promise<PassCategoryDetails> {
    try {
      return await this.prisma.passCategory.create({
        data: {
          title: dto.title.trim(),
          slug: dto.slug.trim(),
          description: dto.description?.trim(),
          coverImageUrl: dto.coverImageUrl?.trim(),
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
        select: passCategorySelect,
      });
    } catch (error) {
      handlePrismaError(error, 'Pass category');
    }
  }

  async updateCategory(
    categoryId: string,
    dto: UpdatePassCategoryDto,
  ): Promise<PassCategoryDetails> {
    await this.ensureCategoryExists(categoryId);

    try {
      return await this.prisma.passCategory.update({
        where: { id: categoryId },
        data: normalizeOptionalValues(dto),
        select: passCategorySelect,
      });
    } catch (error) {
      handlePrismaError(error, 'Pass category');
    }
  }

  async deleteCategory(categoryId: string): Promise<{ success: true }> {
    const category = await this.prisma.passCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, coverImageUrl: true },
    });

    if (!category) {
      throw new NotFoundException('Pass category not found');
    }

    await this.prisma.passCategory.delete({ where: { id: categoryId } });
    await deleteUploadedFile(category.coverImageUrl);

    return { success: true };
  }

  async updateCategoryCover(
    categoryId: string,
    coverImageUrl: string,
  ): Promise<PassCategoryDetails> {
    const current = await this.prisma.passCategory.findUnique({
      where: { id: categoryId },
      select: { coverImageUrl: true },
    });

    if (!current) {
      throw new NotFoundException('Pass category not found');
    }

    try {
      await this.prisma.passCategory.update({
        where: { id: categoryId },
        data: { coverImageUrl },
      });
      await deleteUploadedFile(current.coverImageUrl);
    } catch (error) {
      handlePrismaError(error, 'Pass category');
    }

    return this.getAdminCategoryById(categoryId);
  }

  async removeCategoryCover(categoryId: string): Promise<PassCategoryDetails> {
    const current = await this.prisma.passCategory.findUnique({
      where: { id: categoryId },
      select: { coverImageUrl: true },
    });

    if (!current) {
      throw new NotFoundException('Pass category not found');
    }

    try {
      await this.prisma.passCategory.update({
        where: { id: categoryId },
        data: { coverImageUrl: null },
      });
      await deleteUploadedFile(current.coverImageUrl);
    } catch (error) {
      handlePrismaError(error, 'Pass category');
    }

    return this.getAdminCategoryById(categoryId);
  }

  async createVariant(
    categoryId: string,
    dto: CreatePassVariantDto,
  ): Promise<PassCategoryDetails> {
    await this.ensureCategoryExists(categoryId);

    try {
      await this.prisma.passVariant.create({
        data: {
          categoryId,
          title: dto.title.trim(),
          slug: dto.slug.trim(),
          description: dto.description?.trim(),
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Pass variant');
    }

    return this.getAdminCategoryById(categoryId);
  }

  async updateVariant(
    variantId: string,
    dto: UpdatePassVariantDto,
  ): Promise<PassCategoryDetails> {
    const variant = await this.ensureVariantExists(variantId);

    try {
      await this.prisma.passVariant.update({
        where: { id: variantId },
        data: normalizeOptionalValues(dto),
      });
    } catch (error) {
      handlePrismaError(error, 'Pass variant');
    }

    return this.getAdminCategoryById(variant.categoryId);
  }

  async deleteVariant(variantId: string): Promise<{ success: true }> {
    await this.ensureVariantExists(variantId);
    await this.prisma.passVariant.delete({ where: { id: variantId } });

    return { success: true };
  }

  async createGroup(
    variantId: string,
    dto: CreatePassPlanGroupDto,
  ): Promise<PassCategoryDetails> {
    const variant = await this.ensureVariantExists(variantId);

    try {
      await this.prisma.passPlanGroup.create({
        data: {
          variantId,
          title: dto.title.trim(),
          slug: dto.slug.trim(),
          description: dto.description?.trim(),
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Pass plan group');
    }

    return this.getAdminCategoryById(variant.categoryId);
  }

  async updateGroup(
    groupId: string,
    dto: UpdatePassPlanGroupDto,
  ): Promise<PassCategoryDetails> {
    const group = await this.ensureGroupExists(groupId);

    try {
      await this.prisma.passPlanGroup.update({
        where: { id: groupId },
        data: normalizeOptionalValues(dto),
      });
    } catch (error) {
      handlePrismaError(error, 'Pass plan group');
    }

    return this.getAdminCategoryById(group.variant.categoryId);
  }

  async deleteGroup(groupId: string): Promise<{ success: true }> {
    await this.ensureGroupExists(groupId);
    await this.prisma.passPlanGroup.delete({ where: { id: groupId } });

    return { success: true };
  }

  async createPlan(
    groupId: string,
    dto: CreatePassPlanDto,
  ): Promise<PassCategoryDetails> {
    const group = await this.ensureGroupExists(groupId);

    try {
      await this.prisma.passPlan.create({
        data: {
          groupId,
          title: dto.title.trim(),
          slug: dto.slug.trim(),
          description: dto.description?.trim(),
          subtitle: dto.subtitle?.trim(),
          price: rublesToKopecks(dto.price),
          currency: dto.currency?.trim() ?? 'RUB',
          durationValue: dto.durationValue,
          durationUnit: dto.durationUnit,
          visitCount: dto.visitCount,
          billingType: dto.billingType,
          highlightStyle: dto.highlightStyle?.trim(),
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Pass plan');
    }

    return this.getAdminCategoryById(group.variant.categoryId);
  }

  async updatePlan(
    planId: string,
    dto: UpdatePassPlanDto,
  ): Promise<PassCategoryDetails> {
    const plan = await this.ensurePlanExists(planId);

    try {
      const normalized = normalizeOptionalValues(dto);

      await this.prisma.passPlan.update({
        where: { id: planId },
        data: {
          ...normalized,
          price:
            normalized.price === undefined
              ? undefined
              : rublesToKopecks(normalized.price),
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Pass plan');
    }

    return this.getAdminCategoryById(plan.group.variant.categoryId);
  }

  async deletePlan(planId: string): Promise<{ success: true }> {
    await this.ensurePlanExists(planId);
    await this.prisma.passPlan.delete({ where: { id: planId } });

    return { success: true };
  }

  async createBadge(
    planId: string,
    dto: CreatePassBadgeDto,
  ): Promise<PassCategoryDetails> {
    const plan = await this.ensurePlanExists(planId);

    await this.prisma.passBadge.create({
      data: {
        planId,
        label: dto.label.trim(),
        style: dto.style?.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    return this.getAdminCategoryById(plan.group.variant.categoryId);
  }

  async updateBadge(
    badgeId: string,
    dto: UpdatePassBadgeDto,
  ): Promise<PassCategoryDetails> {
    const badge = await this.ensureBadgeExists(badgeId);

    await this.prisma.passBadge.update({
      where: { id: badgeId },
      data: normalizeOptionalValues(dto),
    });

    return this.getAdminCategoryById(badge.plan.group.variant.categoryId);
  }

  async deleteBadge(badgeId: string): Promise<{ success: true }> {
    await this.ensureBadgeExists(badgeId);
    await this.prisma.passBadge.delete({ where: { id: badgeId } });

    return { success: true };
  }

  async createFeature(
    planId: string,
    dto: CreatePassFeatureDto,
  ): Promise<PassCategoryDetails> {
    const plan = await this.ensurePlanExists(planId);

    await this.prisma.passFeature.create({
      data: {
        planId,
        label: dto.label.trim(),
        icon: dto.icon,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    return this.getAdminCategoryById(plan.group.variant.categoryId);
  }

  async updateFeature(
    featureId: string,
    dto: UpdatePassFeatureDto,
  ): Promise<PassCategoryDetails> {
    const feature = await this.ensureFeatureExists(featureId);

    await this.prisma.passFeature.update({
      where: { id: featureId },
      data: normalizeOptionalValues(dto),
    });

    return this.getAdminCategoryById(feature.plan.group.variant.categoryId);
  }

  async deleteFeature(featureId: string): Promise<{ success: true }> {
    await this.ensureFeatureExists(featureId);
    await this.prisma.passFeature.delete({ where: { id: featureId } });

    return { success: true };
  }

  private async getAdminCategoryById(
    categoryId: string,
  ): Promise<PassCategoryDetails> {
    const category = await this.prisma.passCategory.findUnique({
      where: { id: categoryId },
      select: passCategorySelect,
    });

    if (!category) {
      throw new NotFoundException('Pass category not found');
    }

    return mapCategoryPricesToRubles(category);
  }

  private async ensureCategoryExists(categoryId: string) {
    const category = await this.prisma.passCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException('Pass category not found');
    }

    return category;
  }

  private async ensureVariantExists(variantId: string) {
    const variant = await this.prisma.passVariant.findUnique({
      where: { id: variantId },
      select: { id: true, categoryId: true },
    });

    if (!variant) {
      throw new NotFoundException('Pass variant not found');
    }

    return variant;
  }

  private async ensureGroupExists(groupId: string) {
    const group = await this.prisma.passPlanGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        variant: {
          select: {
            categoryId: true,
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Pass plan group not found');
    }

    return group;
  }

  private async ensurePlanExists(planId: string) {
    const plan = await this.prisma.passPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        group: {
          select: {
            variant: {
              select: {
                categoryId: true,
              },
            },
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException('Pass plan not found');
    }

    return plan;
  }

  private async ensureBadgeExists(badgeId: string) {
    const badge = await this.prisma.passBadge.findUnique({
      where: { id: badgeId },
      select: {
        id: true,
        plan: {
          select: {
            group: {
              select: {
                variant: {
                  select: {
                    categoryId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!badge) {
      throw new NotFoundException('Pass badge not found');
    }

    return badge;
  }

  private async ensureFeatureExists(featureId: string) {
    const feature = await this.prisma.passFeature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        plan: {
          select: {
            group: {
              select: {
                variant: {
                  select: {
                    categoryId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!feature) {
      throw new NotFoundException('Pass feature not found');
    }

    return feature;
  }

  private async seedInitialCatalog(): Promise<void> {
    const categoriesCount = await this.prisma.passCategory.count();

    if (categoriesCount > 0) {
      return;
    }

    for (const category of buildInitialPassCatalog()) {
      await this.prisma.passCategory.create({
        data: category,
      });
    }
  }
}

function normalizeOptionalValues<T extends object>(dto: T): T {
  return Object.fromEntries(
    Object.entries(dto).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value.trim()];
      }

      return [key, value];
    }),
  ) as T;
}

function buildInitialPassCatalog(): Prisma.PassCategoryCreateInput[] {
  return [
    createCategory({
      title: 'Безлимитные абонементы ежедневного посещения',
      slug: 'unlimited-daily',
      description:
        'Полный доступ к клубу. Гостевые визиты действуют только для людей, которые не зарегистрированы в базе клуба. На годовые абонементы доступна рассрочка на 2 месяца равными частями. При продлении действуют индивидуальные условия, уточняйте у администратора.',
      coverImageUrl: '/buy/image1.jpg',
      sortOrder: 0,
      variants: [
        createVariant({
          title: 'Ежедневное посещение',
          slug: 'daily-access',
          description:
            'Свободное посещение комплекса в рамках выбранного тарифа.',
          sortOrder: 0,
          groups: [
            createGroup({
              title: 'Вездеход',
              slug: 'all-access',
              description:
                'Бассейн, тренажерный зал и групповые занятия в одном абонементе.',
              sortOrder: 0,
              plans: [
                createPlan({
                  title: '1 месяц (безлимит)',
                  slug: '1-month-unlimited',
                  subtitle: '2 гостевых визита',
                  price: 8490,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 0,
                  badges: [createBadge('Гостевые визиты', 'gift', 0)],
                  features: [
                    createFeature('Бассейн', PassFeatureIcon.POOL, 0),
                    createFeature(
                      'Тренажерный зал',
                      PassFeatureIcon.DUMBBELL,
                      1,
                    ),
                    createFeature(
                      'Групповые занятия',
                      PassFeatureIcon.COMBO,
                      2,
                    ),
                    createFeature('2 гостевых визита', PassFeatureIcon.GIFT, 3),
                  ],
                }),
                createPlan({
                  title: '6 месяцев (безлимит)',
                  slug: '6-months-unlimited',
                  subtitle: '20 дней заморозки',
                  price: 23990,
                  durationValue: 6,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 1,
                  badges: [createBadge('Заморозка', 'featured', 0)],
                  features: [
                    createFeature('Бассейн', PassFeatureIcon.POOL, 0),
                    createFeature(
                      'Тренажерный зал',
                      PassFeatureIcon.DUMBBELL,
                      1,
                    ),
                    createFeature(
                      'Групповые занятия',
                      PassFeatureIcon.COMBO,
                      2,
                    ),
                    createFeature(
                      '20 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      3,
                    ),
                  ],
                }),
                createPlan({
                  title: '12 месяцев (безлимит)',
                  slug: '12-months-unlimited',
                  subtitle: '30 дней заморозки',
                  price: 32490,
                  durationValue: 12,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  highlightStyle: 'popular',
                  sortOrder: 2,
                  badges: [
                    createBadge('Популярный', 'featured', 0),
                    createBadge('Заморозка', 'success', 1),
                  ],
                  features: [
                    createFeature('Бассейн', PassFeatureIcon.POOL, 0),
                    createFeature(
                      'Тренажерный зал',
                      PassFeatureIcon.DUMBBELL,
                      1,
                    ),
                    createFeature(
                      'Групповые занятия',
                      PassFeatureIcon.COMBO,
                      2,
                    ),
                    createFeature(
                      '30 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      3,
                    ),
                  ],
                }),
              ],
            }),
            createGroup({
              title: 'Бассейн + тренажерный зал',
              slug: 'pool-gym',
              description:
                'Комбинированный доступ без включенных групповых занятий.',
              sortOrder: 1,
              plans: [
                createPlan({
                  title: 'Разовое посещение',
                  slug: 'single-visit',
                  price: 1390,
                  billingType: BillingType.SINGLE_VISIT,
                  sortOrder: 0,
                  features: [
                    createFeature(
                      'Разовый вход в комплекс',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'Бассейн и тренажерный зал',
                      PassFeatureIcon.COMBO,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (6 посещений)',
                  slug: '1-month-6-visits',
                  price: 3990,
                  visitCount: 6,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.VISIT_PACK,
                  sortOrder: 1,
                  features: [
                    createFeature(
                      '6 посещений за месяц',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'Бассейн и тренажерный зал',
                      PassFeatureIcon.COMBO,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (безлимит)',
                  slug: '1-month-unlimited',
                  price: 6490,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 2,
                  features: [
                    createFeature(
                      'Безлимитное посещение на месяц',
                      PassFeatureIcon.FLAME,
                      0,
                    ),
                    createFeature(
                      'Бассейн и тренажерный зал',
                      PassFeatureIcon.COMBO,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '6 месяцев (безлимит)',
                  slug: '6-months-unlimited',
                  subtitle: '20 дней заморозки',
                  price: 19990,
                  durationValue: 6,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 3,
                  badges: [createBadge('Заморозка', 'featured', 0)],
                  features: [
                    createFeature(
                      'Безлимитное посещение',
                      PassFeatureIcon.FLAME,
                      0,
                    ),
                    createFeature(
                      'Бассейн и тренажерный зал',
                      PassFeatureIcon.COMBO,
                      1,
                    ),
                    createFeature(
                      '20 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      2,
                    ),
                  ],
                }),
                createPlan({
                  title: '12 месяцев (безлимит)',
                  slug: '12-months-unlimited',
                  subtitle: '30 дней заморозки',
                  price: 28490,
                  durationValue: 12,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 4,
                  badges: [createBadge('Заморозка', 'success', 0)],
                  features: [
                    createFeature(
                      'Безлимитное посещение',
                      PassFeatureIcon.FLAME,
                      0,
                    ),
                    createFeature(
                      'Бассейн и тренажерный зал',
                      PassFeatureIcon.COMBO,
                      1,
                    ),
                    createFeature(
                      '30 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      2,
                    ),
                  ],
                }),
              ],
            }),
            createGroup({
              title: 'Тренажерный зал',
              slug: 'gym',
              sortOrder: 2,
              plans: [
                createPlan({
                  title: 'Разовое посещение',
                  slug: 'single-visit',
                  price: 790,
                  billingType: BillingType.SINGLE_VISIT,
                  sortOrder: 0,
                  features: [
                    createFeature(
                      'Разовый вход в тренажерный зал',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (6 посещений)',
                  slug: '1-month-6-visits',
                  price: 2490,
                  visitCount: 6,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.VISIT_PACK,
                  sortOrder: 1,
                  features: [
                    createFeature(
                      '6 посещений за месяц',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'Доступ в тренажерный зал',
                      PassFeatureIcon.DUMBBELL,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (безлимит)',
                  slug: '1-month-unlimited',
                  price: 3990,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 2,
                  features: [
                    createFeature(
                      'Безлимитный тренажерный зал',
                      PassFeatureIcon.DUMBBELL,
                      0,
                    ),
                  ],
                }),
                createPlan({
                  title: '6 месяцев (безлимит)',
                  slug: '6-months-unlimited',
                  subtitle: '20 дней заморозки',
                  price: 16490,
                  durationValue: 6,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 3,
                  badges: [createBadge('Заморозка', 'featured', 0)],
                  features: [
                    createFeature(
                      'Безлимитный тренажерный зал',
                      PassFeatureIcon.DUMBBELL,
                      0,
                    ),
                    createFeature(
                      '20 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '12 месяцев (безлимит)',
                  slug: '12-months-unlimited',
                  subtitle: '30 дней заморозки',
                  price: 23490,
                  durationValue: 12,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 4,
                  badges: [createBadge('Заморозка', 'success', 0)],
                  features: [
                    createFeature(
                      'Безлимитный тренажерный зал',
                      PassFeatureIcon.DUMBBELL,
                      0,
                    ),
                    createFeature(
                      '30 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      1,
                    ),
                  ],
                }),
              ],
            }),
            createGroup({
              title: 'Бассейн',
              slug: 'pool',
              sortOrder: 3,
              plans: [
                createPlan({
                  title: 'Разовое посещение',
                  slug: 'single-visit',
                  price: 990,
                  billingType: BillingType.SINGLE_VISIT,
                  sortOrder: 0,
                  features: [
                    createFeature(
                      'Разовый вход в бассейн',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (6 посещений)',
                  slug: '1-month-6-visits',
                  price: 2990,
                  visitCount: 6,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.VISIT_PACK,
                  sortOrder: 1,
                  features: [
                    createFeature(
                      '6 посещений за месяц',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature('Доступ в бассейн', PassFeatureIcon.POOL, 1),
                  ],
                }),
                createPlan({
                  title: '1 месяц (безлимит)',
                  slug: '1-month-unlimited',
                  price: 4490,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 2,
                  features: [
                    createFeature(
                      'Безлимитный бассейн',
                      PassFeatureIcon.POOL,
                      0,
                    ),
                  ],
                }),
                createPlan({
                  title: '6 месяцев (безлимит)',
                  slug: '6-months-unlimited',
                  subtitle: '20 дней заморозки',
                  price: 17990,
                  durationValue: 6,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 3,
                  badges: [createBadge('Заморозка', 'featured', 0)],
                  features: [
                    createFeature(
                      'Безлимитный бассейн',
                      PassFeatureIcon.POOL,
                      0,
                    ),
                    createFeature(
                      '20 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '12 месяцев (безлимит)',
                  slug: '12-months-unlimited',
                  subtitle: '30 дней заморозки',
                  price: 25490,
                  durationValue: 12,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  sortOrder: 4,
                  badges: [createBadge('Заморозка', 'success', 0)],
                  features: [
                    createFeature(
                      'Безлимитный бассейн',
                      PassFeatureIcon.POOL,
                      0,
                    ),
                    createFeature(
                      '30 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      1,
                    ),
                  ],
                }),
              ],
            }),
            createGroup({
              title: 'ВИП-абонемент',
              slug: 'vip-membership',
              description:
                'Свободное посещение комплекса в любое время. При желании можно оформить личный шкафчик отдельно за 10 000 руб.',
              sortOrder: 4,
              plans: [
                createPlan({
                  title: '12 месяцев (безлимит)',
                  slug: '12-months-unlimited',
                  subtitle: 'VIP-формат',
                  description:
                    'Свободное посещение комплекса в любое время: бассейн, тренажерный зал, групповые занятия, личный шкафчик, постоянная выдача 3 полотенец, розетка в шкафчике, 2 гостевых визита в тренажерный зал, 30 дней заморозки.',
                  price: 43000,
                  durationValue: 12,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.UNLIMITED,
                  highlightStyle: 'vip',
                  sortOrder: 0,
                  badges: [
                    createBadge('VIP', 'featured', 0),
                    createBadge('Заморозка', 'success', 1),
                  ],
                  features: [
                    createFeature(
                      'Свободное посещение комплекса',
                      PassFeatureIcon.COMBO,
                      0,
                    ),
                    createFeature('Личный шкафчик', PassFeatureIcon.GIFT, 1),
                    createFeature(
                      'Постоянная выдача 3 полотенец',
                      PassFeatureIcon.GIFT,
                      2,
                    ),
                    createFeature(
                      'Розетка в шкафчике',
                      PassFeatureIcon.GIFT,
                      3,
                    ),
                    createFeature(
                      '2 гостевых визита в тренажерный зал',
                      PassFeatureIcon.GIFT,
                      4,
                    ),
                    createFeature(
                      '30 дней заморозки',
                      PassFeatureIcon.SNOWFLAKE,
                      5,
                    ),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    createCategory({
      title: 'Абонемент "Лучшие часы"',
      slug: 'best-hours',
      description:
        'Посещение комплекса с 11:00 до 16:00. Подходит для дневного графика и также участвует в общих условиях продления и рассрочки для годовых тарифов.',
      coverImageUrl: '/buy/image2.jpg',
      sortOrder: 1,
      variants: [
        createVariant({
          title: '11:00-16:00',
          slug: '11-16',
          description: 'Доступ в дневное окно 11:00-16:00.',
          sortOrder: 0,
          groups: [
            createUnlimitedDurationGroup(
              'Бассейн + тренажерный зал',
              'pool-gym',
              0,
              [
                { months: 1, price: 4490 },
                { months: 6, price: 17990 },
                { months: 12, price: 22990 },
              ],
              ['Бассейн и тренажерный зал', PassFeatureIcon.COMBO],
            ),
            createUnlimitedDurationGroup(
              'Тренажерный зал',
              'gym',
              1,
              [
                { months: 1, price: 2490 },
                { months: 6, price: 14990 },
                { months: 12, price: 18990 },
              ],
              ['Доступ в тренажерный зал', PassFeatureIcon.DUMBBELL],
            ),
            createUnlimitedDurationGroup(
              'Бассейн',
              'pool',
              2,
              [
                { months: 1, price: 2990 },
                { months: 6, price: 15990 },
                { months: 12, price: 20990 },
              ],
              ['Доступ в бассейн', PassFeatureIcon.POOL],
            ),
          ],
        }),
      ],
    }),
    createCategory({
      title: 'Детские секции',
      slug: 'kids-sections',
      description:
        'Занятия по расписанию. При покупке для двоих детей действует скидка 5%, для троих детей 10%. Продление по болезни возможно один раз на абонемент при предъявлении справки.',
      coverImageUrl: '/buy/image3.jpg',
      sortOrder: 2,
      variants: [
        createVariant({
          title: 'Секции',
          slug: 'sections',
          description: 'Регулярные детские занятия по направлениям.',
          sortOrder: 0,
          groups: [
            createVisitPackGroup(
              'Секция по плаванию 6+',
              'swimming-6-plus',
              0,
              890,
              [
                { visits: 6, price: 2790 },
                { visits: 8, price: 3790 },
                { visits: 12, price: 4490 },
              ],
              'Занятия по плаванию 6+',
              PassFeatureIcon.POOL,
            ),
            createVisitPackGroup(
              'Секция по ММА 6+',
              'mma-6-plus',
              1,
              590,
              [
                { visits: 6, price: 2590 },
                { visits: 8, price: 3590 },
                { visits: 12, price: 4490 },
              ],
              'Секция ММА и единоборств 6+',
              PassFeatureIcon.COMBO,
            ),
            createVisitPackGroup(
              'Секция по ОФП 4+',
              'ofp-4-plus',
              2,
              590,
              [
                { visits: 6, price: 2590 },
                { visits: 8, price: 3590 },
                { visits: 12, price: 4490 },
              ],
              'Секция ОФП 4+',
              PassFeatureIcon.DUMBBELL,
            ),
            createVisitPackGroup(
              'Секция по теннису',
              'tennis',
              3,
              500,
              [
                { visits: 6, price: 2590 },
                { visits: 8, price: 3590 },
                { visits: 12, price: 4490 },
              ],
              'Секция по теннису',
              PassFeatureIcon.TICKET,
            ),
          ],
        }),
        createVariant({
          title: 'LEVEL-UP 13-17',
          slug: 'level-up-13-17',
          description: 'Подростковая программа с выбором тренера.',
          sortOrder: 1,
          groups: [
            createGroup({
              title: 'LEVEL-UP',
              slug: 'level-up',
              description: 'Тренеры: Александр и Антонина.',
              sortOrder: 0,
              plans: [
                createPlan({
                  title: '1 месяц (8 посещений)',
                  slug: '1-month-8-visits-alexander',
                  subtitle: 'тренер Александр',
                  price: 4000,
                  visitCount: 8,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.VISIT_PACK,
                  sortOrder: 0,
                  features: [
                    createFeature(
                      '8 посещений за месяц',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'Тренер Александр',
                      PassFeatureIcon.CALENDAR,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (8 посещений)',
                  slug: '1-month-8-visits-antonina',
                  subtitle: 'тренер Антонина',
                  price: 4500,
                  visitCount: 8,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.VISIT_PACK,
                  sortOrder: 1,
                  features: [
                    createFeature(
                      '8 посещений за месяц',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'Тренер Антонина',
                      PassFeatureIcon.CALENDAR,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (12 посещений)',
                  slug: '1-month-12-visits-alexander',
                  subtitle: 'тренер Александр',
                  price: 4500,
                  visitCount: 12,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.VISIT_PACK,
                  sortOrder: 2,
                  features: [
                    createFeature(
                      '12 посещений за месяц',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'Тренер Александр',
                      PassFeatureIcon.CALENDAR,
                      1,
                    ),
                  ],
                }),
                createPlan({
                  title: '1 месяц (12 посещений)',
                  slug: '1-month-12-visits-antonina',
                  subtitle: 'тренер Антонина',
                  price: 5000,
                  visitCount: 12,
                  durationValue: 1,
                  durationUnit: DurationUnit.MONTH,
                  billingType: BillingType.VISIT_PACK,
                  sortOrder: 3,
                  features: [
                    createFeature(
                      '12 посещений за месяц',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'Тренер Антонина',
                      PassFeatureIcon.CALENDAR,
                      1,
                    ),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    createCategory({
      title: 'Взрослые групповые занятия',
      slug: 'adult-group-classes',
      description: 'Групповые тренировки по расписанию для взрослых.',
      coverImageUrl: '/buy/image4.png',
      sortOrder: 3,
      variants: [
        createVariant({
          title: 'По расписанию',
          slug: 'by-schedule',
          description: 'Выбирайте формат тренировки и удобный пакет посещений.',
          sortOrder: 0,
          groups: [
            createVisitPackGroup(
              'Худеем вместе',
              'weight-loss',
              0,
              590,
              [
                { visits: 6, price: 2490 },
                { visits: 8, price: 2990 },
                { visits: 12, price: 3490 },
              ],
              'Групповые занятия по расписанию',
              PassFeatureIcon.CALENDAR,
            ),
            createVisitPackGroup(
              'Здоровая спина',
              'healthy-back',
              1,
              590,
              [
                { visits: 6, price: 2490 },
                { visits: 8, price: 2990 },
                { visits: 12, price: 3490 },
              ],
              'Групповые занятия по расписанию',
              PassFeatureIcon.CALENDAR,
            ),
            createVisitPackGroup(
              'Йога',
              'yoga',
              2,
              590,
              [
                { visits: 6, price: 2490 },
                { visits: 8, price: 2990 },
                { visits: 12, price: 3490 },
              ],
              'Групповые занятия по расписанию',
              PassFeatureIcon.CALENDAR,
            ),
            createVisitPackGroup(
              'Фитнес-интенсив',
              'fitness-intensive',
              3,
              590,
              [
                { visits: 6, price: 2490 },
                { visits: 8, price: 2990 },
                { visits: 12, price: 3490 },
              ],
              'Групповые занятия по расписанию',
              PassFeatureIcon.CALENDAR,
            ),
            createVisitPackGroup(
              'Аквааэробика',
              'aqua-aerobics',
              4,
              790,
              [
                { visits: 6, price: 2990 },
                { visits: 8, price: 3490 },
                { visits: 12, price: 3990 },
              ],
              'Групповые занятия в бассейне',
              PassFeatureIcon.POOL,
            ),
            createVisitPackGroup(
              'Стретчинг',
              'stretching',
              5,
              590,
              [
                { visits: 6, price: 2490 },
                { visits: 8, price: 2990 },
                { visits: 12, price: 3490 },
              ],
              'Групповые занятия по расписанию',
              PassFeatureIcon.CALENDAR,
            ),
            createVisitPackGroup(
              'Шейпинг',
              'shaping',
              6,
              590,
              [
                { visits: 6, price: 2490 },
                { visits: 8, price: 2990 },
                { visits: 12, price: 3490 },
              ],
              'Групповые занятия по расписанию',
              PassFeatureIcon.CALENDAR,
            ),
          ],
        }),
      ],
    }),
    createCategory({
      title: 'Подростковый абонемент для клиентов в возрасте 13-17 лет',
      slug: 'teen-membership',
      description: 'Для оформления требуется письменное согласие родителей.',
      coverImageUrl: '/buy/image2.jpg',
      sortOrder: 4,
      variants: [
        createVariant({
          title: '1 месяц (безлимит)',
          slug: '1-month-unlimited',
          sortOrder: 0,
          groups: [
            createSinglePlanGroup('Бассейн + тренажерный зал', 'pool-gym', 0, {
              price: 4490,
              features: [
                createFeature('Безлимит на месяц', PassFeatureIcon.FLAME, 0),
                createFeature(
                  'Бассейн и тренажерный зал',
                  PassFeatureIcon.COMBO,
                  1,
                ),
              ],
            }),
            createSinglePlanGroup('Тренажерный зал', 'gym', 1, {
              price: 2990,
              features: [
                createFeature('Безлимит на месяц', PassFeatureIcon.FLAME, 0),
                createFeature(
                  'Доступ в тренажерный зал',
                  PassFeatureIcon.DUMBBELL,
                  1,
                ),
              ],
            }),
            createSinglePlanGroup('Бассейн', 'pool', 2, {
              price: 3490,
              features: [
                createFeature('Безлимит на месяц', PassFeatureIcon.FLAME, 0),
                createFeature('Доступ в бассейн', PassFeatureIcon.POOL, 1),
              ],
            }),
          ],
        }),
        createVariant({
          title: '1 месяц (дневной 11:00-17:00)',
          slug: '1-month-daytime-11-17',
          description: 'Доступ в дневное окно с 11:00 до 17:00.',
          sortOrder: 1,
          groups: [
            createSinglePlanGroup('Бассейн + тренажерный зал', 'pool-gym', 0, {
              price: 3990,
              subtitle: '11:00-17:00',
              features: [
                createFeature(
                  'Дневной доступ 11:00-17:00',
                  PassFeatureIcon.CALENDAR,
                  0,
                ),
                createFeature(
                  'Бассейн и тренажерный зал',
                  PassFeatureIcon.COMBO,
                  1,
                ),
              ],
            }),
            createSinglePlanGroup('Тренажерный зал', 'gym', 1, {
              price: 2490,
              subtitle: '11:00-17:00',
              features: [
                createFeature(
                  'Дневной доступ 11:00-17:00',
                  PassFeatureIcon.CALENDAR,
                  0,
                ),
                createFeature(
                  'Доступ в тренажерный зал',
                  PassFeatureIcon.DUMBBELL,
                  1,
                ),
              ],
            }),
            createSinglePlanGroup('Бассейн', 'pool', 2, {
              price: 2990,
              subtitle: '11:00-17:00',
              features: [
                createFeature(
                  'Дневной доступ 11:00-17:00',
                  PassFeatureIcon.CALENDAR,
                  0,
                ),
                createFeature('Доступ в бассейн', PassFeatureIcon.POOL, 1),
              ],
            }),
          ],
        }),
      ],
    }),
    createCategory({
      title: 'Персональные тренировки с тренером',
      slug: 'personal-training',
      description:
        'Персональная тренировка в тренажерном зале или бассейне доступна при наличии любого абонемента.',
      coverImageUrl: '/buy/image3.jpg',
      sortOrder: 5,
      variants: [
        createVariant({
          title: 'Разовые и пакеты',
          slug: 'single-and-packages',
          sortOrder: 0,
          groups: [
            createGroup({
              title: 'Персональная тренировка в тренажерном зале или бассейне',
              slug: 'personal-session',
              description: 'Доступно при наличии любого абонемента.',
              sortOrder: 0,
              plans: [
                createPlan({
                  title: '1 тренировка',
                  slug: '1-training',
                  price: 950,
                  visitCount: 1,
                  billingType: BillingType.SINGLE_VISIT,
                  sortOrder: 0,
                  features: [
                    createFeature(
                      '1 персональная тренировка',
                      PassFeatureIcon.TICKET,
                      0,
                    ),
                    createFeature(
                      'При наличии любого абонемента',
                      PassFeatureIcon.CALENDAR,
                      1,
                    ),
                  ],
                }),
                createTrainingPackPlan(6, 5900, 1),
                createTrainingPackPlan(8, 6900, 2),
                createTrainingPackPlan(10, 7900, 3),
                createTrainingPackPlan(12, 8900, 4),
              ],
            }),
          ],
        }),
        createTrainerSubscriptionVariant(
          'Тренерский бассейн',
          'trainer-pool',
          1,
          'Абонемент "Тренерский" — бассейн',
          'Посещение клуба только в дни тренировок.',
          PassFeatureIcon.POOL,
          [
            { visits: 6, price: 7900 },
            { visits: 8, price: 8900 },
            { visits: 10, price: 9900 },
          ],
        ),
        createTrainerSubscriptionVariant(
          'Тренерский сплит бассейн',
          'trainer-split-pool',
          2,
          'Абонемент "Тренерский" — сплит, 2 человека, бассейн',
          'Стоимость указана с каждого. Посещение клуба только в дни тренировок.',
          PassFeatureIcon.POOL,
          [
            { visits: 6, price: 5900 },
            { visits: 8, price: 6900 },
            { visits: 10, price: 7900 },
          ],
          true,
        ),
        createTrainerSubscriptionVariant(
          'Тренерский зал',
          'trainer-gym',
          3,
          'Абонемент "Тренерский" — тренажерный зал',
          'Посещение клуба только в дни тренировок.',
          PassFeatureIcon.DUMBBELL,
          [
            { visits: 6, price: 7400 },
            { visits: 8, price: 8400 },
            { visits: 10, price: 9400 },
            { visits: 12, price: 10400 },
          ],
        ),
        createTrainerSubscriptionVariant(
          'Тренерский сплит зал',
          'trainer-split-gym',
          4,
          'Абонемент "Тренерский" — сплит, 2 человека, тренажерный зал',
          'Стоимость указана с каждого. Посещение клуба только в дни тренировок.',
          PassFeatureIcon.DUMBBELL,
          [
            { visits: 6, price: 5900 },
            { visits: 8, price: 6900 },
            { visits: 10, price: 7900 },
            { visits: 12, price: 8900 },
          ],
          true,
        ),
      ],
    }),
  ];
}

function createCategory(input: {
  title: string;
  slug: string;
  description?: string;
  coverImageUrl: string;
  sortOrder: number;
  variants: Prisma.PassVariantCreateWithoutCategoryInput[];
}): Prisma.PassCategoryCreateInput {
  return {
    title: input.title,
    slug: input.slug,
    description: input.description,
    coverImageUrl: input.coverImageUrl,
    sortOrder: input.sortOrder,
    isActive: true,
    variants: {
      create: input.variants,
    },
  };
}

function createVariant(input: {
  title: string;
  slug: string;
  description?: string;
  sortOrder: number;
  groups: Prisma.PassPlanGroupCreateWithoutVariantInput[];
}): Prisma.PassVariantCreateWithoutCategoryInput {
  return {
    title: input.title,
    slug: input.slug,
    description: input.description,
    sortOrder: input.sortOrder,
    isActive: true,
    groups: {
      create: input.groups,
    },
  };
}

function createGroup(input: {
  title: string;
  slug: string;
  description?: string;
  sortOrder: number;
  plans: Prisma.PassPlanCreateWithoutGroupInput[];
}): Prisma.PassPlanGroupCreateWithoutVariantInput {
  return {
    title: input.title,
    slug: input.slug,
    description: input.description,
    sortOrder: input.sortOrder,
    isActive: true,
    plans: {
      create: input.plans,
    },
  };
}

function createPlan(input: {
  title: string;
  slug: string;
  price: number;
  description?: string;
  subtitle?: string;
  durationValue?: number;
  durationUnit?: DurationUnit;
  visitCount?: number;
  billingType?: BillingType;
  highlightStyle?: string;
  sortOrder: number;
  badges?: Prisma.PassBadgeCreateWithoutPlanInput[];
  features?: Prisma.PassFeatureCreateWithoutPlanInput[];
}): Prisma.PassPlanCreateWithoutGroupInput {
  return {
    title: input.title,
    slug: input.slug,
    description: input.description,
    subtitle: input.subtitle,
    price: rublesToKopecks(input.price),
    currency: 'RUB',
    durationValue: input.durationValue,
    durationUnit: input.durationUnit,
    visitCount: input.visitCount,
    billingType: input.billingType,
    highlightStyle: input.highlightStyle,
    sortOrder: input.sortOrder,
    isActive: true,
    badges: input.badges?.length
      ? {
          create: input.badges,
        }
      : undefined,
    features: input.features?.length
      ? {
          create: input.features,
        }
      : undefined,
  };
}

function createBadge(
  label: string,
  style: string,
  sortOrder: number,
): Prisma.PassBadgeCreateWithoutPlanInput {
  return {
    label,
    style,
    sortOrder,
  };
}

function createFeature(
  label: string,
  icon: PassFeatureIcon,
  sortOrder: number,
): Prisma.PassFeatureCreateWithoutPlanInput {
  return {
    label,
    icon,
    sortOrder,
  };
}

function createUnlimitedDurationGroup(
  title: string,
  slug: string,
  sortOrder: number,
  durations: Array<{ months: number; price: number }>,
  accessFeature: [string, PassFeatureIcon],
): Prisma.PassPlanGroupCreateWithoutVariantInput {
  return createGroup({
    title,
    slug,
    sortOrder,
    plans: durations.map(({ months, price }, index) =>
      createPlan({
        title: `${months} ${formatMonthLabel(months)} (безлимит)`,
        slug: `${months}-months-unlimited`,
        subtitle: months === 1 ? '11:00-16:00' : undefined,
        price,
        durationValue: months,
        durationUnit: DurationUnit.MONTH,
        billingType: BillingType.UNLIMITED,
        sortOrder: index,
        badges:
          months === 12
            ? [createBadge('Рассрочка 2 месяца', 'featured', 0)]
            : undefined,
        features: [
          createFeature('Безлимитное посещение', PassFeatureIcon.FLAME, 0),
          createFeature(accessFeature[0], accessFeature[1], 1),
          createFeature(
            'Окно посещения 11:00-16:00',
            PassFeatureIcon.CALENDAR,
            2,
          ),
        ],
      }),
    ),
  });
}

function createVisitPackGroup(
  title: string,
  slug: string,
  sortOrder: number,
  singlePrice: number,
  packs: Array<{ visits: number; price: number }>,
  featureLabel: string,
  featureIcon: PassFeatureIcon,
): Prisma.PassPlanGroupCreateWithoutVariantInput {
  return createGroup({
    title,
    slug,
    sortOrder,
    plans: [
      createPlan({
        title: 'Разовое посещение',
        slug: 'single-visit',
        price: singlePrice,
        billingType: BillingType.SINGLE_VISIT,
        sortOrder: 0,
        features: [
          createFeature('Разовое посещение', PassFeatureIcon.TICKET, 0),
          createFeature(featureLabel, featureIcon, 1),
        ],
      }),
      ...packs.map(({ visits, price }, index) =>
        createPlan({
          title: `1 месяц (${visits} посещений)`,
          slug: `1-month-${visits}-visits`,
          price,
          visitCount: visits,
          durationValue: 1,
          durationUnit: DurationUnit.MONTH,
          billingType: BillingType.VISIT_PACK,
          sortOrder: index + 1,
          features: [
            createFeature(
              `${visits} посещений за месяц`,
              PassFeatureIcon.TICKET,
              0,
            ),
            createFeature(featureLabel, featureIcon, 1),
          ],
        }),
      ),
    ],
  });
}

function createSinglePlanGroup(
  title: string,
  slug: string,
  sortOrder: number,
  input: {
    price: number;
    subtitle?: string;
    features: Prisma.PassFeatureCreateWithoutPlanInput[];
  },
): Prisma.PassPlanGroupCreateWithoutVariantInput {
  return createGroup({
    title,
    slug,
    sortOrder,
    plans: [
      createPlan({
        title: title,
        slug: slug,
        subtitle: input.subtitle,
        price: input.price,
        durationValue: 1,
        durationUnit: DurationUnit.MONTH,
        billingType: BillingType.UNLIMITED,
        sortOrder: 0,
        features: input.features,
      }),
    ],
  });
}

function createTrainingPackPlan(
  visits: number,
  price: number,
  sortOrder: number,
): Prisma.PassPlanCreateWithoutGroupInput {
  return createPlan({
    title: `${visits} тренировок`,
    slug: `${visits}-trainings`,
    price,
    visitCount: visits,
    billingType: BillingType.VISIT_PACK,
    sortOrder,
    features: [
      createFeature(
        `${visits} персональных тренировок`,
        PassFeatureIcon.TICKET,
        0,
      ),
      createFeature(
        'При наличии любого абонемента',
        PassFeatureIcon.CALENDAR,
        1,
      ),
    ],
  });
}

function createTrainerSubscriptionVariant(
  title: string,
  slug: string,
  sortOrder: number,
  groupTitle: string,
  groupDescription: string,
  featureIcon: PassFeatureIcon,
  plans: Array<{ visits: number; price: number }>,
  isSplit = false,
): Prisma.PassVariantCreateWithoutCategoryInput {
  return createVariant({
    title,
    slug,
    sortOrder,
    groups: [
      createGroup({
        title: groupTitle,
        slug: slug,
        description: groupDescription,
        sortOrder: 0,
        plans: plans.map(({ visits, price }, index) =>
          createPlan({
            title: `1 месяц (${visits} посещений)`,
            slug: `1-month-${visits}-visits`,
            subtitle: isSplit ? 'с каждого' : undefined,
            price,
            visitCount: visits,
            durationValue: 1,
            durationUnit: DurationUnit.MONTH,
            billingType: BillingType.VISIT_PACK,
            sortOrder: index,
            features: [
              createFeature(
                `${visits} тренировок за месяц`,
                PassFeatureIcon.TICKET,
                0,
              ),
              createFeature(
                isSplit
                  ? 'Стоимость указана с каждого'
                  : 'Индивидуальный формат',
                isSplit ? PassFeatureIcon.COMBO : featureIcon,
                1,
              ),
              createFeature(
                'Посещение клуба только в дни тренировок',
                PassFeatureIcon.CALENDAR,
                2,
              ),
            ],
          }),
        ),
      }),
    ],
  });
}

function formatMonthLabel(months: number): string {
  if (months % 10 === 1 && months % 100 !== 11) {
    return 'месяц';
  }

  if ([2, 3, 4].includes(months % 10) && ![12, 13, 14].includes(months % 100)) {
    return 'месяца';
  }

  return 'месяцев';
}

function mapCategoryPricesToRubles(category: PassCategoryDetails): PassCategoryDetails {
  return {
    ...category,
    variants: category.variants.map((variant) => ({
      ...variant,
      groups: variant.groups.map((group) => ({
        ...group,
        plans: group.plans.map((plan) => ({
          ...plan,
          price: kopecksToRubles(plan.price),
        })),
      })),
    })),
  };
}
