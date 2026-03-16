import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import type { SessionUser } from '../common/auth/session-user.interface';
import { CreateMembershipFreezeDto } from './dto/create-membership-freeze.dto';
import { MembershipsService } from './memberships.service';

@Controller('memberships')
@UseGuards(AuthenticatedGuard)
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get('me')
  getMyMemberships(@CurrentUser() currentUser: SessionUser) {
    return this.membershipsService.getMyMemberships(currentUser.userId);
  }

  @Post(':id/freeze')
  freezeMembership(
    @CurrentUser() currentUser: SessionUser,
    @Param('id') membershipId: string,
    @Body() dto: CreateMembershipFreezeDto,
  ) {
    return this.membershipsService.freezeMembership(
      currentUser.userId,
      membershipId,
      dto,
    );
  }

  @Post(':id/unfreeze')
  unfreezeMembership(
    @CurrentUser() currentUser: SessionUser,
    @Param('id') membershipId: string,
  ) {
    return this.membershipsService.unfreezeMembershipForUser(
      currentUser.userId,
      membershipId,
    );
  }
}
