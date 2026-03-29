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
import {
  buildImageStorageName,
  ensureUploadsDirectory,
  toPublicUploadUrl,
  validateImageFile,
} from '../common/uploads/upload.utils';
import { Roles } from '../common/auth/roles.decorator';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainersService } from './trainers.service';

@Controller('admin/trainers')
@UseGuards(AuthenticatedGuard)
@Roles(UserRole.ADMIN)
export class TrainersAdminController {
  constructor(private readonly trainersService: TrainersService) {}

  @Get()
  listAdmin() {
    return this.trainersService.listAdmin();
  }

  @Post()
  create(@Body() dto: CreateTrainerDto) {
    return this.trainersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTrainerDto) {
    return this.trainersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.trainersService.remove(id);
  }

  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: async (_request, _file, callback) => {
          const destination = await ensureUploadsDirectory('trainers');
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
  async uploadPhoto(@Param('id') id: string, @UploadedFile() file?: any) {
    validateImageFile(file);
    const photoUrl = toPublicUploadUrl('trainers', file.filename);
    const trainer = await this.trainersService.updatePhoto(id, photoUrl);
    return {
      url: trainer.photoUrl,
      item: trainer,
    };
  }

  @Delete(':id/photo')
  async deletePhoto(@Param('id') id: string) {
    const trainer = await this.trainersService.removePhoto(id);
    return {
      url: trainer.photoUrl,
      item: trainer,
    };
  }
}
