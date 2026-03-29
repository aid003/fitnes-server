import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { SessionUser } from '../common/auth/session-user.interface';
import { AdsService } from './ads.service';

@Controller('ads')
@UseGuards(AuthenticatedGuard)
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  @Get('active')
  getActive(@CurrentUser() user: SessionUser | null) {
    return this.adsService.getActiveForUser(user!.userId);
  }

  @Post(':id/dismiss')
  dismiss(@CurrentUser() user: SessionUser | null, @Param('id') id: string) {
    return this.adsService.dismiss(user!.userId, id);
  }
}
