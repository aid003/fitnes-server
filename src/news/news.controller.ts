import { Controller, Get, Param } from '@nestjs/common';
import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get()
  listPublic() {
    return this.newsService.listPublic();
  }

  @Get(':slug')
  getPublicBySlug(@Param('slug') slug: string) {
    return this.newsService.getPublicBySlug(slug);
  }
}
