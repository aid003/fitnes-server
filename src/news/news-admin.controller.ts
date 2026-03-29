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
import { CreateNewsArticleDto } from './dto/create-news-article.dto';
import { UpdateNewsArticleDto } from './dto/update-news-article.dto';
import { NewsService } from './news.service';

@Controller('admin/news')
@UseGuards(AuthenticatedGuard)
@Roles(UserRole.ADMIN)
export class NewsAdminController {
  constructor(private readonly newsService: NewsService) {}

  @Get()
  listAdmin() {
    return this.newsService.listAdmin();
  }

  @Post()
  create(@Body() dto: CreateNewsArticleDto) {
    return this.newsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNewsArticleDto) {
    return this.newsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.newsService.remove(id);
  }

  @Post(':id/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: async (_request, _file, callback) => {
          const destination = await ensureUploadsDirectory('news');
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
  async uploadCover(@Param('id') id: string, @UploadedFile() file?: any) {
    validateImageFile(file);
    const coverImageUrl = toPublicUploadUrl('news', file.filename);
    const article = await this.newsService.updateCover(id, coverImageUrl);
    return {
      url: article.coverImageUrl,
      item: article,
    };
  }

  @Delete(':id/cover')
  async deleteCover(@Param('id') id: string) {
    const article = await this.newsService.removeCover(id);
    return {
      url: article.coverImageUrl,
      item: article,
    };
  }
}
