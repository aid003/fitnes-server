import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module';
import { PassesModule } from '../passes/passes.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PassesModule, MembershipsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
