import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { deleteUploadedFile } from '../common/uploads/upload.utils';
import { handlePrismaError } from '../common/database/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';

const trainerSelect = {
  id: true,
  name: true,
  slug: true,
  role: true,
  shortBio: true,
  photoUrl: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainerSelect;

export type TrainerRecord = Prisma.TrainerGetPayload<{
  select: typeof trainerSelect;
}>;

@Injectable()
export class TrainersService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(): Promise<TrainerRecord[]> {
    return this.prisma.trainer.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: trainerSelect,
    });
  }

  async listAdmin(): Promise<TrainerRecord[]> {
    return this.prisma.trainer.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: trainerSelect,
    });
  }

  async create(dto: CreateTrainerDto): Promise<TrainerRecord> {
    try {
      return await this.prisma.trainer.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug.trim(),
          role: dto.role.trim(),
          shortBio: dto.shortBio?.trim(),
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
        select: trainerSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'Trainer');
    }
  }

  async update(id: string, dto: UpdateTrainerDto): Promise<TrainerRecord> {
    try {
      return await this.prisma.trainer.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          slug: dto.slug?.trim(),
          role: dto.role?.trim(),
          shortBio: dto.shortBio?.trim(),
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
        },
        select: trainerSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'Trainer');
    }
  }

  async updatePhoto(id: string, photoUrl: string): Promise<TrainerRecord> {
    const current = await this.prisma.trainer.findUnique({
      where: { id },
      select: { photoUrl: true },
    });

    try {
      const nextTrainer = await this.prisma.trainer.update({
        where: { id },
        data: { photoUrl },
        select: trainerSelect,
      });

      await deleteUploadedFile(current?.photoUrl);
      return nextTrainer;
    } catch (error) {
      handlePrismaError(error, 'Trainer');
    }
  }

  async removePhoto(id: string): Promise<TrainerRecord> {
    const current = await this.prisma.trainer.findUnique({
      where: { id },
      select: { photoUrl: true },
    });

    try {
      const nextTrainer = await this.prisma.trainer.update({
        where: { id },
        data: { photoUrl: null },
        select: trainerSelect,
      });

      await deleteUploadedFile(current?.photoUrl);
      return nextTrainer;
    } catch (error) {
      handlePrismaError(error, 'Trainer');
    }
  }

  async remove(id: string): Promise<{ success: true }> {
    const current = await this.prisma.trainer.findUnique({
      where: { id },
      select: { photoUrl: true },
    });

    try {
      await this.prisma.trainer.delete({
        where: { id },
      });
      await deleteUploadedFile(current?.photoUrl);
      return { success: true };
    } catch (error) {
      handlePrismaError(error, 'Trainer');
    }
  }
}
