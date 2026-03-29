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
import { UserRole } from '@prisma/client';
import { diskStorage } from 'multer';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { Roles } from '../common/auth/roles.decorator';
import {
  buildImageStorageName,
  ensureUploadsDirectory,
  toPublicUploadUrl,
  validateImageFile,
} from '../common/uploads/upload.utils';
import { AdsService } from './ads.service';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';

@Controller('admin/ads')
@UseGuards(AuthenticatedGuard)
@Roles(UserRole.ADMIN)
export class AdsAdminController {
  constructor(private readonly adsService: AdsService) {}

  @Get()
  listAdmin() {
    return this.adsService.listAdmin();
  }

  @Post()
  create(@Body() dto: CreateAdDto) {
    return this.adsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdDto) {
    return this.adsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adsService.remove(id);
  }

  @Post(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: async (_request, _file, callback) => {
          const destination = await ensureUploadsDirectory('ads');
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
  async uploadImage(@Param('id') id: string, @UploadedFile() file?: any) {
    validateImageFile(file);
    const imageUrl = toPublicUploadUrl('ads', file.filename);
    const item = await this.adsService.updateImage(id, imageUrl);
    return {
      url: item.imageUrl,
      item,
    };
  }

  @Delete(':id/image')
  async deleteImage(@Param('id') id: string) {
    const item = await this.adsService.removeImage(id);
    return {
      url: item.imageUrl,
      item,
    };
  }
}
