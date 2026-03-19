import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../common/security/password.service';
import { handlePrismaError } from '../common/database/prisma-errors';
import { UpdateSelfDto } from './dto/update-self.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof userPublicSelect;
}>;

export type UserAuthState = {
  id: string;
  role: UserRole;
  isActive: boolean;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    isActive?: boolean;
  }): Promise<PublicUser> {
    try {
      return await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          role: input.role ?? UserRole.USER,
          isActive: input.isActive ?? true,
        },
        select: userPublicSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'User');
    }
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async getPublicById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userPublicSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getMe(userId: string): Promise<PublicUser> {
    return this.getPublicById(userId);
  }

  async listUsers(): Promise<PublicUser[]> {
    return this.prisma.user.findMany({
      select: userPublicSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAuthState(userId: string): Promise<UserAuthState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateMe(userId: string, dto: UpdateSelfDto): Promise<PublicUser> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    const passwordChangeRequested =
      dto.currentPassword !== undefined || dto.newPassword !== undefined;

    if (passwordChangeRequested) {
      if (!dto.currentPassword || !dto.newPassword) {
        throw new BadRequestException(
          'currentPassword and newPassword must be provided together',
        );
      }

      const isPasswordValid = await this.passwordService.compare(
        dto.currentPassword,
        currentUser.passwordHash,
      );

      if (!isPasswordValid) {
        throw new ForbiddenException('Current password is invalid');
      }
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: dto.name,
          passwordHash: dto.newPassword
            ? await this.passwordService.hash(dto.newPassword)
            : undefined,
        },
        select: userPublicSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'User');
    }
  }

  async updateUser(userId: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.ensureUserExists(userId);

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: dto.name,
          email: dto.email,
          role: dto.role,
        },
        select: userPublicSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'User');
    }
  }

  async updateUserStatus(
    userId: string,
    isActive: boolean,
  ): Promise<PublicUser> {
    await this.ensureUserExists(userId);

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: userPublicSelect,
    });
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }
}
