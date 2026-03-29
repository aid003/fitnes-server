import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { handlePrismaError } from '../common/database/prisma-errors';
import { deleteUploadedFile } from '../common/uploads/upload.utils';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';

const adminAdSelect = {
  id: true,
  title: true,
  imageUrl: true,
  targetUrl: true,
  startsAt: true,
  endsAt: true,
  repeatIntervalDays: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const activeAdSelect = {
  id: true,
  title: true,
  imageUrl: true,
  targetUrl: true,
  startsAt: true,
  endsAt: true,
  repeatIntervalDays: true,
  dismissals: {
    select: {
      dismissedAt: true,
    },
  },
} as const;

export type AdminAdBannerRecord = {
  id: string;
  title: string;
  imageUrl: string | null;
  targetUrl: string;
  startsAt: Date;
  endsAt: Date;
  repeatIntervalDays: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ActiveAdCandidate = {
  id: string;
  title: string;
  imageUrl: string | null;
  targetUrl: string;
  startsAt: Date;
  endsAt: Date;
  repeatIntervalDays: number;
  dismissals: Array<{
    dismissedAt: Date;
  }>;
};

type ActiveAdResponse = Omit<ActiveAdCandidate, 'dismissals'>;

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdmin(): Promise<AdminAdBannerRecord[]> {
    return this.getAdBannerDelegate().findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: adminAdSelect,
    });
  }

  async create(dto: CreateAdDto): Promise<AdminAdBannerRecord> {
    this.validateDateRange(dto.startsAt, dto.endsAt);

    try {
      return await this.getAdBannerDelegate().create({
        data: this.buildCreateData(dto),
        select: adminAdSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'AdBanner');
    }
  }

  async update(id: string, dto: UpdateAdDto): Promise<AdminAdBannerRecord> {
    this.validateDateRange(dto.startsAt, dto.endsAt);

    try {
      return await this.getAdBannerDelegate().update({
        where: { id },
        data: this.buildUpdateData(dto),
        select: adminAdSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'AdBanner');
    }
  }

  async updateImage(id: string, imageUrl: string): Promise<AdminAdBannerRecord> {
    const current = await this.getAdBannerDelegate().findUnique({
      where: { id },
      select: { imageUrl: true },
    });

    try {
      const banner = await this.getAdBannerDelegate().update({
        where: { id },
        data: { imageUrl },
        select: adminAdSelect,
      });
      await deleteUploadedFile(current?.imageUrl);
      return banner;
    } catch (error) {
      handlePrismaError(error, 'AdBanner');
    }
  }

  async removeImage(id: string): Promise<AdminAdBannerRecord> {
    const current = await this.getAdBannerDelegate().findUnique({
      where: { id },
      select: { imageUrl: true },
    });

    try {
      const banner = await this.getAdBannerDelegate().update({
        where: { id },
        data: { imageUrl: null },
        select: adminAdSelect,
      });
      await deleteUploadedFile(current?.imageUrl);
      return banner;
    } catch (error) {
      handlePrismaError(error, 'AdBanner');
    }
  }

  async remove(id: string): Promise<{ success: true }> {
    const current = await this.getAdBannerDelegate().findUnique({
      where: { id },
      select: { imageUrl: true },
    });

    try {
      await this.getAdBannerDelegate().delete({
        where: { id },
      });
      await deleteUploadedFile(current?.imageUrl);
      return { success: true };
    } catch (error) {
      handlePrismaError(error, 'AdBanner');
    }
  }

  async getActiveForUser(userId: string): Promise<ActiveAdResponse | null> {
    const now = new Date();
    const banners = (await this.getAdBannerDelegate().findMany({
      where: {
        isActive: true,
        imageUrl: {
          not: null,
        },
        startsAt: {
          lte: now,
        },
        endsAt: {
          gte: now,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        ...activeAdSelect,
        dismissals: {
          where: {
            userId,
          },
          select: {
            dismissedAt: true,
          },
        },
      },
    })) as ActiveAdCandidate[];

    const match = banners.find((banner) => this.isBannerAvailableForUser(banner, now));

    if (!match) {
      return null;
    }

    const { dismissals: _dismissals, ...banner } = match;
    return banner;
  }

  async dismiss(userId: string, bannerId: string) {
    const banner = await this.getAdBannerDelegate().findUnique({
      where: { id: bannerId },
      select: { id: true },
    });

    if (!banner) {
      throw new NotFoundException('Рекламный баннер не найден');
    }

    const dismissedAt = new Date();

    await this.getDismissalDelegate().upsert({
      where: {
        userId_bannerId: {
          userId,
          bannerId,
        },
      },
      create: {
        userId,
        bannerId,
        dismissedAt,
      },
      update: {
        dismissedAt,
      },
    });

    return {
      success: true as const,
      dismissedAt,
    };
  }

  private getAdBannerDelegate() {
    return (this.prisma as any).adBanner;
  }

  private getDismissalDelegate() {
    return (this.prisma as any).userAdBannerDismissal;
  }

  private isBannerAvailableForUser(
    banner: ActiveAdCandidate,
    now: Date,
  ): boolean {
    const dismissal = banner.dismissals[0];

    if (!dismissal) {
      return true;
    }

    const nextAllowedAt = new Date(dismissal.dismissedAt);
    nextAllowedAt.setUTCDate(
      nextAllowedAt.getUTCDate() + banner.repeatIntervalDays,
    );

    return nextAllowedAt <= now;
  }

  private validateDateRange(startsAt?: string, endsAt?: string) {
    if (!startsAt && !endsAt) {
      return;
    }

    if (!startsAt || !endsAt) {
      throw new BadRequestException(
        'Дата начала и окончания показа должны быть указаны вместе',
      );
    }

    const starts = new Date(startsAt);
    const ends = new Date(endsAt);

    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
      throw new BadRequestException('Некорректный формат даты баннера');
    }

    if (ends < starts) {
      throw new BadRequestException(
        'Дата окончания показа не может быть раньше даты начала',
      );
    }
  }

  private buildCreateData(dto: CreateAdDto) {
    return {
      title: dto.title.trim(),
      targetUrl: dto.targetUrl.trim(),
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      repeatIntervalDays: dto.repeatIntervalDays,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
  }

  private buildUpdateData(dto: UpdateAdDto) {
    return {
      title: typeof dto.title === 'string' ? dto.title.trim() : undefined,
      targetUrl:
        typeof dto.targetUrl === 'string' ? dto.targetUrl.trim() : undefined,
      startsAt:
        typeof dto.startsAt === 'string' ? new Date(dto.startsAt) : undefined,
      endsAt: typeof dto.endsAt === 'string' ? new Date(dto.endsAt) : undefined,
      repeatIntervalDays: dto.repeatIntervalDays,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    };
  }
}
