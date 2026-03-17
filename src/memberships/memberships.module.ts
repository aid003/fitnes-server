import { Module } from '@nestjs/common';
import { MembershipQrService } from './membership-qr.service';
import { MembershipsAdminController } from './memberships-admin.controller';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  controllers: [MembershipsController, MembershipsAdminController],
  providers: [MembershipsService, MembershipQrService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
