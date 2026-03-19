import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module';
import { PassesModule } from '../passes/passes.module';
import { PaymentsAdminController } from './payments-admin.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PassesModule, MembershipsModule],
  controllers: [PaymentsController, PaymentsAdminController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
