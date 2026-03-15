import { Module } from '@nestjs/common';
import { PassesAdminController } from './passes-admin.controller';
import { PassesPublicController } from './passes-public.controller';
import { PassesService } from './passes.service';

@Module({
  controllers: [PassesPublicController, PassesAdminController],
  providers: [PassesService],
  exports: [PassesService],
})
export class PassesModule {}
