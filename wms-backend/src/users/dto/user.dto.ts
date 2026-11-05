import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Mirrors Prisma `enum Role` — the DTO must never accept a role the guard doesn't know. */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'WAREHOUSE_ADMIN',
  'OPERATOR',
  'CUSTOMER_SERVICE',
  'FINANCE',
  'CUSTOMER',
] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

/**
 * Body for POST /users.
 *
 * No password field on purpose: the server generates a temporary password and
 * returns it exactly once in the response. An admin-chosen password would be
 * known to two people, and would tempt reuse of one shared value for every hire.
 */
export class CreateUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(50)
  name!: string;

  @IsIn(USER_ROLES, { message: `角色必须是 ${USER_ROLES.join(' / ')} 之一` })
  role!: UserRoleValue;

  @IsOptional()
  @IsString()
  warehouseId?: string | null;
}

/** Body for PUT /users/:id — every field optional, role changes are guarded in the service. */
export class UpdateUserDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsIn(USER_ROLES, { message: `角色必须是 ${USER_ROLES.join(' / ')} 之一` })
  role?: UserRoleValue;

  @IsOptional()
  @IsString()
  warehouseId?: string | null;
}

export class ListUsersQueryDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsIn(USER_ROLES) role?: UserRoleValue;
  @IsOptional() @IsString() warehouseId?: string;
  /** Arrives as a query string; "true"/"false" only. */
  @IsOptional() @IsIn(['true', 'false']) isActive?: 'true' | 'false';
  @IsOptional() page?: number;
  @IsOptional() pageSize?: number;
}
