import { Module } from '@nestjs/common';
import { MembershipsAdminController } from './memberships-admin.controller';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  controllers: [MembershipsController, MembershipsAdminController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
