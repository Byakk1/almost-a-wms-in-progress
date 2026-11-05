import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ok } from '../common/api-response';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService, Actor } from './users.service';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';

/**
 * Staff account management. Reads for both admin tiers; every write is SUPER_ADMIN
 * only — a warehouse admin can see who has access to their warehouse but cannot
 * mint or disable accounts (see PRD §10 for the deferred question).
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Get()
  async list(@Query() q: ListUsersQueryDto, @Req() req: { user: Actor }) {
    const r = await this.users.list(q, req.user);
    return ok(r.data, r.pagination);
  }

  @Roles('SUPER_ADMIN')
  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req: { user: Actor }) {
    return ok(await this.users.create(dto, req.user));
  }

  @Roles('SUPER_ADMIN')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: { user: Actor }) {
    return ok(await this.users.update(id, dto, req.user));
  }

  @Roles('SUPER_ADMIN')
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Req() req: { user: Actor }) {
    return ok(await this.users.deactivate(id, req.user));
  }

  @Roles('SUPER_ADMIN')
  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string, @Req() req: { user: Actor }) {
    return ok(await this.users.reactivate(id, req.user));
  }

  @Roles('SUPER_ADMIN')
  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string, @Req() req: { user: Actor }) {
    return ok(await this.users.resetPassword(id, req.user));
  }
}
