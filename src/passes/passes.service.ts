import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  BillingType,
  DurationUnit,
  PassFeatureIcon,
  Prisma,
} from '@prisma/client';
import { handlePrismaError } from '../common/database/prisma-errors';
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

    return category;
  }

  async listAdminCategories(): Promise<PassCategoryDetails[]> {
    return this.prisma.passCategory.findMany({
      select: passCategorySelect,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createCategory(dto: CreatePassCategoryDto): Promise<PassCategoryDetails> {
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
    await this.ensureCategoryExists(categoryId);
    await this.prisma.passCategory.delete({ where: { id: categoryId } });

    return { success: true };
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
          price: dto.price,
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
      await this.prisma.passPlan.update({
        where: { id: planId },
        data: normalizeOptionalValues(dto),
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

  private async getAdminCategoryById(categoryId: string): Promise<PassCategoryDetails> {
    const category = await this.prisma.passCategory.findUnique({
      where: { id: categoryId },
      select: passCategorySelect,
    });

    if (!category) {
      throw new NotFoundException('Pass category not found');
    }

    return category;
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

    await this.prisma.passCategory.create({
      data: {
        title: 'Безлимитные абонементы ежедневного посещения',
        slug: 'unlimited-daily',
        description: 'Выберите формат и срок',
        coverImageUrl: '/buy/image1.jpg',
        sortOrder: 0,
        isActive: true,
        variants: {
          create: [
            {
              title: 'Вездеход',
              slug: 'all-access',
              sortOrder: 0,
              isActive: true,
              groups: {
                create: [
                  {
                    title: 'Краткосрочные',
                    slug: 'short-term',
                    sortOrder: 0,
                    plans: {
                      create: [
                        {
                          title: 'Разовое посещение',
                          slug: 'single-visit',
                          price: 1590,
                          billingType: BillingType.SINGLE_VISIT,
                          sortOrder: 0,
                          features: {
                            create: [
                              { label: 'Разовое посещение клуба', icon: PassFeatureIcon.TICKET, sortOrder: 0 },
                            ],
                          },
                        },
                        {
                          title: '1 месяц / 6 посещений',
                          slug: '1-month-6-visits',
                          subtitle: '665 ₽ за тренировку',
                          price: 3990,
                          visitCount: 6,
                          durationValue: 1,
                          durationUnit: DurationUnit.MONTH,
                          billingType: BillingType.VISIT_PACK,
                          sortOrder: 1,
                          badges: {
                            create: [{ label: '+2 дня в подарок', style: 'gift', sortOrder: 0 }],
                          },
                          features: {
                            create: [
                              { label: '665 ₽ за тренировку', icon: PassFeatureIcon.TICKET, sortOrder: 0 },
                              { label: '+2 дня в подарок', icon: PassFeatureIcon.GIFT, sortOrder: 1 },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  {
                    title: 'Долгосрочные',
                    slug: 'long-term',
                    sortOrder: 1,
                    plans: {
                      create: [
                        {
                          title: '1 месяц / безлимит',
                          slug: '1-month-unlimited',
                          subtitle: 'Открой доступ ежедневно',
                          price: 6490,
                          durationValue: 1,
                          durationUnit: DurationUnit.MONTH,
                          billingType: BillingType.UNLIMITED,
                          sortOrder: 0,
                          badges: {
                            create: [{ label: '+2 дня в подарок', style: 'gift', sortOrder: 0 }],
                          },
                          features: {
                            create: [
                              { label: 'Открой доступ ежедневно', icon: PassFeatureIcon.FLAME, sortOrder: 0 },
                              { label: '+2 дня в подарок', icon: PassFeatureIcon.GIFT, sortOrder: 1 },
                            ],
                          },
                        },
                        {
                          title: '6 месяцев / безлимит',
                          slug: '6-months-unlimited',
                          subtitle: '+20 дней заморозки',
                          price: 19990,
                          durationValue: 6,
                          durationUnit: DurationUnit.MONTH,
                          billingType: BillingType.UNLIMITED,
                          sortOrder: 1,
                          badges: {
                            create: [{ label: '+2 дня в подарок', style: 'gift', sortOrder: 0 }],
                          },
                          features: {
                            create: [
                              { label: '+20 дней заморозки', icon: PassFeatureIcon.SNOWFLAKE, sortOrder: 0 },
                              { label: '+2 дня в подарок', icon: PassFeatureIcon.GIFT, sortOrder: 1 },
                            ],
                          },
                        },
                        {
                          title: '12 месяцев / безлимит',
                          slug: '12-months-unlimited',
                          subtitle: '+30 дней заморозки',
                          price: 28490,
                          durationValue: 12,
                          durationUnit: DurationUnit.MONTH,
                          billingType: BillingType.UNLIMITED,
                          highlightStyle: 'popular',
                          sortOrder: 2,
                          badges: {
                            create: [
                              { label: 'Популярный', style: 'featured', sortOrder: 0 },
                              { label: 'Выгодно', style: 'success', sortOrder: 1 },
                              { label: '+2 дня в подарок', style: 'gift', sortOrder: 2 },
                            ],
                          },
                          features: {
                            create: [
                              { label: '+30 дней заморозки', icon: PassFeatureIcon.SNOWFLAKE, sortOrder: 0 },
                              { label: '+2 дня в подарок', icon: PassFeatureIcon.GIFT, sortOrder: 1 },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              title: 'Бассейн и Тренажерный зал',
              slug: 'pool-gym',
              sortOrder: 1,
              isActive: true,
            },
            {
              title: 'Тренажерный зал',
              slug: 'gym-only',
              sortOrder: 2,
              isActive: true,
            },
            {
              title: 'Бассейн',
              slug: 'pool-only',
              sortOrder: 3,
              isActive: true,
            },
          ],
        },
      },
    });

    await this.prisma.passCategory.createMany({
      data: [
        {
          title: 'Абонемент “Лучшие часы” (Посещение комплекса с 11:00 до 16:00)',
          slug: 'best-hours',
          coverImageUrl: '/buy/image2.jpg',
          sortOrder: 1,
          isActive: true,
        },
        {
          title: 'Детские секции (по расписанию)',
          slug: 'kids-sections',
          coverImageUrl: '/buy/image3.jpg',
          sortOrder: 2,
          isActive: true,
        },
        {
          title: 'Взрослые групповые занятия (по расписанию)',
          slug: 'adult-group-classes',
          coverImageUrl: '/buy/image4.png',
          sortOrder: 3,
          isActive: true,
        },
        {
          title: 'Подростковый абонемент для клиентов в возрасте (13-17 лет)',
          slug: 'teen-membership',
          coverImageUrl: '/buy/image2.jpg',
          sortOrder: 4,
          isActive: true,
        },
        {
          title: 'Персональные тренировки с тренером',
          slug: 'personal-training',
          coverImageUrl: '/buy/image3.jpg',
          sortOrder: 5,
          isActive: true,
        },
      ],
    });
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
