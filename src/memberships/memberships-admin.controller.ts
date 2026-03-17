import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { ScanMembershipQrDto } from './dto/scan-membership-qr.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipsService } from './memberships.service';

@Controller('admin/memberships')
@UseGuards(AuthenticatedGuard)
@Roles(UserRole.ADMIN)
export class MembershipsAdminController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  listMemberships() {
    return this.membershipsService.listAdminMemberships();
  }

  @Post('qr/scan')
  scanMembershipQr(@Body() dto: ScanMembershipQrDto) {
    return this.membershipsService.scanMembershipQr(dto.content);
  }

  @Post()
  createMembership(@Body() dto: CreateMembershipDto) {
    return this.membershipsService.createMembership(dto);
  }

  @Patch(':id')
  updateMembership(
    @Param('id') membershipId: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.membershipsService.updateMembership(membershipId, dto);
  }

  @Post(':id/expire')
  expireMembership(@Param('id') membershipId: string) {
    return this.membershipsService.expireMembership(membershipId);
  }

  @Post(':id/unfreeze')
  unfreezeMembership(@Param('id') membershipId: string) {
    return this.membershipsService.unfreezeMembership(membershipId);
  }
}
