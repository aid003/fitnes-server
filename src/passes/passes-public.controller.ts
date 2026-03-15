import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { PassesService } from './passes.service';

@Controller('passes/categories')
@UseGuards(AuthenticatedGuard)
export class PassesPublicController {
  constructor(private readonly passesService: PassesService) {}

  @Get()
  listCategories() {
    return this.passesService.listPublicCategories();
  }

  @Get(':slug')
  getCategory(@Param('slug') slug: string) {
    return this.passesService.getPublicCategoryBySlug(slug);
  }
}
