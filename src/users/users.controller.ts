import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import type { SessionUser } from '../common/auth/session-user.interface';
import { UpdateSelfDto } from './dto/update-self.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() currentUser: SessionUser) {
    return this.usersService.getMe(currentUser.userId);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() currentUser: SessionUser,
    @Body() dto: UpdateSelfDto,
  ) {
    return this.usersService.updateMe(currentUser.userId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  listUsers() {
    return this.usersService.listUsers();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  getUser(@Param('id') id: string) {
    return this.usersService.getPublicById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  updateUserStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.usersService.updateUserStatus(id, dto.isActive);
  }
}
