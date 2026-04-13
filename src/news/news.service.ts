import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { deleteUploadedFile, normalizeStringArray } from '../common/uploads/upload.utils';
import { handlePrismaError } from '../common/database/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNewsArticleDto } from './dto/create-news-article.dto';
import { UpdateNewsArticleDto } from './dto/update-news-article.dto';

const newsSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  coverImageUrl: true,
  lead: true,
  highlightsTitle: true,
  highlights: true,
  contentRichText: true,
  tags: true,
  publishedAt: true,
  sortOrder: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NewsArticleSelect;

export type NewsArticleRecord = Prisma.NewsArticleGetPayload<{
  select: typeof newsSelect;
}>;

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(): Promise<NewsArticleRecord[]> {
    return this.prisma.newsArticle.findMany({
      where: { isPublished: true },
      orderBy: [{ publishedAt: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: newsSelect,
    });
  }

  async getPublicBySlug(slug: string): Promise<NewsArticleRecord> {
    const article = await this.prisma.newsArticle.findFirst({
      where: {
        slug,
        isPublished: true,
      },
      select: newsSelect,
    });

    if (!article) {
      throw new NotFoundException('Новость не найдена');
    }

    return article;
  }

  async listAdmin(): Promise<NewsArticleRecord[]> {
    return this.prisma.newsArticle.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: newsSelect,
    });
  }

  async create(dto: CreateNewsArticleDto): Promise<NewsArticleRecord> {
    try {
      return await this.prisma.newsArticle.create({
        data: this.buildCreateData(dto),
        select: newsSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'NewsArticle');
    }
  }

  async update(id: string, dto: UpdateNewsArticleDto): Promise<NewsArticleRecord> {
    try {
      return await this.prisma.newsArticle.update({
        where: { id },
        data: this.buildUpdateData(dto),
        select: newsSelect,
      });
    } catch (error) {
      handlePrismaError(error, 'NewsArticle');
    }
  }

  async updateCover(id: string, coverImageUrl: string): Promise<NewsArticleRecord> {
    const current = await this.prisma.newsArticle.findUnique({
      where: { id },
      select: { coverImageUrl: true },
    });

    try {
      const article = await this.prisma.newsArticle.update({
        where: { id },
        data: { coverImageUrl },
        select: newsSelect,
      });
      await deleteUploadedFile(current?.coverImageUrl);
      return article;
    } catch (error) {
      handlePrismaError(error, 'NewsArticle');
    }
  }

  async removeCover(id: string): Promise<NewsArticleRecord> {
    const current = await this.prisma.newsArticle.findUnique({
      where: { id },
      select: { coverImageUrl: true },
    });

    try {
      const article = await this.prisma.newsArticle.update({
        where: { id },
        data: { coverImageUrl: null },
        select: newsSelect,
      });
      await deleteUploadedFile(current?.coverImageUrl);
      return article;
    } catch (error) {
      handlePrismaError(error, 'NewsArticle');
    }
  }

  async remove(id: string): Promise<{ success: true }> {
    const current = await this.prisma.newsArticle.findUnique({
      where: { id },
      select: { coverImageUrl: true },
    });

    try {
      await this.prisma.newsArticle.delete({
        where: { id },
      });
      await deleteUploadedFile(current?.coverImageUrl);
      return { success: true };
    } catch (error) {
      handlePrismaError(error, 'NewsArticle');
    }
  }

  private buildCreateData(dto: CreateNewsArticleDto): Prisma.NewsArticleCreateInput {
    const highlights = dto.highlights !== undefined ? normalizeStringArray(dto.highlights) : undefined;
    const tags = dto.tags !== undefined ? normalizeStringArray(dto.tags) : undefined;
    const highlightsTitle = dto.highlightsTitle?.trim() || undefined;

    return {
      title: dto.title.trim(),
      slug: dto.slug.trim(),
      excerpt: dto.excerpt?.trim() || undefined,
      lead: dto.lead?.trim() || undefined,
      highlightsTitle: highlights && highlights.length > 0 ? highlightsTitle : undefined,
      highlights,
      contentRichText: dto.contentRichText.trim(),
      tags,
      publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : undefined,
      sortOrder: dto.sortOrder ?? 0,
      isPublished: dto.isPublished ?? false,
    };
  }

  private buildUpdateData(dto: UpdateNewsArticleDto): Prisma.NewsArticleUpdateInput {
    const hasHighlights = dto.highlights !== undefined;
    const normalizedHighlights = hasHighlights ? normalizeStringArray(dto.highlights) : undefined;
    const normalizedTags = dto.tags !== undefined ? normalizeStringArray(dto.tags) : undefined;

    return {
      title: typeof dto.title === 'string' ? dto.title.trim() : undefined,
      slug: typeof dto.slug === 'string' ? dto.slug.trim() : undefined,
      excerpt:
        typeof dto.excerpt === 'string' ? dto.excerpt.trim() || null : undefined,
      lead: typeof dto.lead === 'string' ? dto.lead.trim() || null : undefined,
      highlightsTitle:
        typeof dto.highlightsTitle === 'string'
          ? dto.highlightsTitle.trim()
            ? dto.highlightsTitle.trim()
            : null
          : hasHighlights && normalizedHighlights?.length === 0
            ? null
            : undefined,
      highlights: hasHighlights ? normalizedHighlights : undefined,
      contentRichText:
        typeof dto.contentRichText === 'string' ? dto.contentRichText.trim() : undefined,
      tags: dto.tags !== undefined ? normalizedTags : undefined,
      publishedAt:
        dto.publishedAt !== undefined
          ? dto.publishedAt
            ? new Date(dto.publishedAt)
            : null
          : undefined,
      sortOrder: dto.sortOrder,
      isPublished: dto.isPublished,
    };
  }
}
