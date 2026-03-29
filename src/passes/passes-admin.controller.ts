import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UserRole } from '@prisma/client';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { Roles } from '../common/auth/roles.decorator';
import {
  buildImageStorageName,
  ensureUploadsDirectory,
  toPublicUploadUrl,
  validateImageFile,
} from '../common/uploads/upload.utils';
import { CreatePassBadgeDto } from './dto/create-pass-badge.dto';
import { CreatePassCategoryDto } from './dto/create-pass-category.dto';
import { CreatePassPlanGroupDto } from './dto/create-pass-plan-group.dto';
import { CreatePassPlanDto } from './dto/create-pass-plan.dto';
import { CreatePassVariantDto } from './dto/create-pass-variant.dto';
import { UpdatePassBadgeDto } from './dto/update-pass-badge.dto';
import { UpdatePassCategoryDto } from './dto/update-pass-category.dto';
import { CreatePassFeatureDto } from './dto/create-pass-feature.dto';
import { UpdatePassPlanGroupDto } from './dto/update-pass-plan-group.dto';
import { UpdatePassPlanDto } from './dto/update-pass-plan.dto';
import { UpdatePassFeatureDto } from './dto/update-pass-feature.dto';
import { UpdatePassVariantDto } from './dto/update-pass-variant.dto';
import { PassesService } from './passes.service';

@Controller('admin/passes')
@UseGuards(AuthenticatedGuard)
@Roles(UserRole.ADMIN)
export class PassesAdminController {
  constructor(private readonly passesService: PassesService) {}

  @Get('categories')
  listCategories() {
    return this.passesService.listAdminCategories();
  }

  @Post('categories')
  createCategory(@Body() dto: CreatePassCategoryDto) {
    return this.passesService.createCategory(dto);
  }

  @Patch('categories/:categoryId')
  updateCategory(
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdatePassCategoryDto,
  ) {
    return this.passesService.updateCategory(categoryId, dto);
  }

  @Delete('categories/:categoryId')
  deleteCategory(@Param('categoryId') categoryId: string) {
    return this.passesService.deleteCategory(categoryId);
  }

  @Post('categories/:categoryId/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: async (_request, _file, callback) => {
          const destination = await ensureUploadsDirectory('passes');
          callback(null, destination);
        },
        filename: (_request, file, callback) => {
          callback(null, buildImageStorageName(file.originalname));
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async uploadCategoryCover(
    @Param('categoryId') categoryId: string,
    @UploadedFile() file?: any,
  ) {
    validateImageFile(file);
    const coverImageUrl = toPublicUploadUrl('passes', file.filename);
    const item = await this.passesService.updateCategoryCover(
      categoryId,
      coverImageUrl,
    );
    return {
      url: item.coverImageUrl,
      item,
    };
  }

  @Delete('categories/:categoryId/cover')
  async deleteCategoryCover(@Param('categoryId') categoryId: string) {
    const item = await this.passesService.removeCategoryCover(categoryId);
    return {
      url: item.coverImageUrl,
      item,
    };
  }

  @Post('categories/:categoryId/variants')
  createVariant(
    @Param('categoryId') categoryId: string,
    @Body() dto: CreatePassVariantDto,
  ) {
    return this.passesService.createVariant(categoryId, dto);
  }

  @Patch('variants/:variantId')
  updateVariant(
    @Param('variantId') variantId: string,
    @Body() dto: UpdatePassVariantDto,
  ) {
    return this.passesService.updateVariant(variantId, dto);
  }

  @Delete('variants/:variantId')
  deleteVariant(@Param('variantId') variantId: string) {
    return this.passesService.deleteVariant(variantId);
  }

  @Post('variants/:variantId/groups')
  createGroup(
    @Param('variantId') variantId: string,
    @Body() dto: CreatePassPlanGroupDto,
  ) {
    return this.passesService.createGroup(variantId, dto);
  }

  @Patch('groups/:groupId')
  updateGroup(
    @Param('groupId') groupId: string,
    @Body() dto: UpdatePassPlanGroupDto,
  ) {
    return this.passesService.updateGroup(groupId, dto);
  }

  @Delete('groups/:groupId')
  deleteGroup(@Param('groupId') groupId: string) {
    return this.passesService.deleteGroup(groupId);
  }

  @Post('groups/:groupId/plans')
  createPlan(
    @Param('groupId') groupId: string,
    @Body() dto: CreatePassPlanDto,
  ) {
    return this.passesService.createPlan(groupId, dto);
  }

  @Patch('plans/:planId')
  updatePlan(@Param('planId') planId: string, @Body() dto: UpdatePassPlanDto) {
    return this.passesService.updatePlan(planId, dto);
  }

  @Delete('plans/:planId')
  deletePlan(@Param('planId') planId: string) {
    return this.passesService.deletePlan(planId);
  }

  @Post('plans/:planId/badges')
  createBadge(
    @Param('planId') planId: string,
    @Body() dto: CreatePassBadgeDto,
  ) {
    return this.passesService.createBadge(planId, dto);
  }

  @Patch('badges/:badgeId')
  updateBadge(
    @Param('badgeId') badgeId: string,
    @Body() dto: UpdatePassBadgeDto,
  ) {
    return this.passesService.updateBadge(badgeId, dto);
  }

  @Delete('badges/:badgeId')
  deleteBadge(@Param('badgeId') badgeId: string) {
    return this.passesService.deleteBadge(badgeId);
  }

  @Post('plans/:planId/features')
  createFeature(
    @Param('planId') planId: string,
    @Body() dto: CreatePassFeatureDto,
  ) {
    return this.passesService.createFeature(planId, dto);
  }

  @Patch('features/:featureId')
  updateFeature(
    @Param('featureId') featureId: string,
    @Body() dto: UpdatePassFeatureDto,
  ) {
    return this.passesService.updateFeature(featureId, dto);
  }

  @Delete('features/:featureId')
  deleteFeature(@Param('featureId') featureId: string) {
    return this.passesService.deleteFeature(featureId);
  }
}
