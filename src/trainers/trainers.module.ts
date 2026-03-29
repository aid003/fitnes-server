import { Module } from '@nestjs/common';
import { TrainersAdminController } from './trainers-admin.controller';
import { TrainersController } from './trainers.controller';
import { TrainersService } from './trainers.service';

@Module({
  controllers: [TrainersController, TrainersAdminController],
  providers: [TrainersService],
})
export class TrainersModule {}
