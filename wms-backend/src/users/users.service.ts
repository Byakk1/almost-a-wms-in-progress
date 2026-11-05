import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from '../common/operation-log.service';
import { isUniqueViolation } from '../common/doc-no';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';

const BCRYPT_ROUNDS = 10;

/** The caller, as decoded from the JWT by JwtAuthGuard (req.user). */
export interface Actor {
  sub: string;
  email?: string;
  role: string;
  warehouseId?: string | null;
}

/** Everything a client may see about a user. passwordHash never leaves the service. */
const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  warehouseId: true,
  warehouse: { select: { id: true, code: true, name: true } },
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/**
 * Temporary passwords: 12 chars from an unambiguous alphabet (no 0/O/1/l/I), from
 * crypto randomness. ~62 bits — a one-time bootstrap credential the staff member is
 * expected to change, not a long-lived secret.
 */
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateTempPassword(length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  return out;
}

/** Emails are case-insensitive identifiers; store one canonical form so @unique means it. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: OperationLogService,
  ) {}

  async list(q: ListUsersQueryDto, actor: Actor) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));

    const where: Prisma.UserWhereInput = {};
    if (q.keyword) {
      where.OR = [
        { name: { contains: q.keyword, mode: 'insensitive' } },
        { email: { contains: q.keyword, mode: 'insensitive' } },
      ];
    }
    if (q.role) where.role = q.role;
    if (q.isActive !== undefined) where.isActive = q.isActive === 'true';
    if (q.warehouseId) where.warehouseId = q.warehouseId;

    // A warehouse admin sees only their own warehouse's staff. The scope comes
    // from the token, never from a query param the caller controls.
    if (actor.role === 'WAREHOUSE_ADMIN') {
      where.warehouseId = actor.warehouseId ?? '__none__';
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, pagination: { page, pageSize, total } };
  }

  async create(dto: CreateUserDto, actor: Actor) {
    await this.assertWarehouseExists(dto.warehouseId);

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          // Normalise here as well as in the DTO: scripts and jobs call the
          // service directly and never pass through the ValidationPipe.
          email: normaliseEmail(dto.email),
          name: dto.name,
          role: dto.role,
          warehouseId: dto.warehouseId || null,
          passwordHash,
        },
        select: SAFE_SELECT,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('该邮箱已被使用');
      throw e;
    }

    await this.audit.log({
      entityType: 'USER',
      entityId: user.id,
      action: 'CREATE',
      afterData: user,
      description: `创建用户 ${user.email}（${user.role}）`,
      operatorId: actor.sub,
      operatorName: actor.email,
    });

    // The only place the cleartext ever exists: this response.
    return { user, tempPassword };
  }

  async update(id: string, dto: UpdateUserDto, actor: Actor) {
    const before = await this.getOrThrow(id);

    // An admin editing their own row may not change their own role — demoting the
    // only SUPER_ADMIN by accident is unrecoverable without SQL.
    if (id === actor.sub && dto.role !== undefined && dto.role !== before.role) {
      throw new BadRequestException('不能修改自己的角色');
    }
    if (dto.role !== undefined && dto.role !== 'SUPER_ADMIN' && before.role === 'SUPER_ADMIN') {
      await this.assertNotLastActiveAdmin(id, '不能降级最后一名启用的超级管理员');
    }
    if (dto.warehouseId !== undefined) await this.assertWarehouseExists(dto.warehouseId);

    let after;
    try {
      after = await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.email !== undefined ? { email: normaliseEmail(dto.email) } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.warehouseId !== undefined ? { warehouseId: dto.warehouseId || null } : {}),
        },
        select: SAFE_SELECT,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('该邮箱已被使用');
      throw e;
    }

    await this.audit.log({
      entityType: 'USER',
      entityId: id,
      action: 'UPDATE',
      beforeData: before,
      afterData: after,
      description: `更新用户 ${after.email}`,
      operatorId: actor.sub,
      operatorName: actor.email,
    });
    return after;
  }

  async deactivate(id: string, actor: Actor) {
    if (id === actor.sub) throw new BadRequestException('不能停用自己的账号');
    const before = await this.getOrThrow(id);
    if (!before.isActive) return before;
    if (before.role === 'SUPER_ADMIN') {
      await this.assertNotLastActiveAdmin(id, '不能停用最后一名启用的超级管理员');
    }

    const after = await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: SAFE_SELECT,
    });
    await this.audit.log({
      entityType: 'USER',
      entityId: id,
      action: 'DEACTIVATE',
      beforeData: { isActive: true },
      afterData: { isActive: false },
      description: `停用用户 ${after.email}`,
      operatorId: actor.sub,
      operatorName: actor.email,
    });
    return after;
  }

  async reactivate(id: string, actor: Actor) {
    const before = await this.getOrThrow(id);
    if (before.isActive) return before;
    const after = await this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: SAFE_SELECT,
    });
    await this.audit.log({
      entityType: 'USER',
      entityId: id,
      action: 'REACTIVATE',
      beforeData: { isActive: false },
      afterData: { isActive: true },
      description: `启用用户 ${after.email}`,
      operatorId: actor.sub,
      operatorName: actor.email,
    });
    return after;
  }

  async resetPassword(id: string, actor: Actor) {
    const user = await this.getOrThrow(id);
    const tempPassword = generateTempPassword();
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS) },
    });
    // Record THAT a reset happened — never the value.
    await this.audit.log({
      entityType: 'USER',
      entityId: id,
      action: 'RESET_PASSWORD',
      description: `重置用户 ${user.email} 的密码`,
      operatorId: actor.sub,
      operatorName: actor.email,
    });
    return { user, tempPassword };
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private async getOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  private async assertWarehouseExists(warehouseId?: string | null) {
    if (!warehouseId) return;
    const wh = await this.prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true } });
    if (!wh) throw new BadRequestException('仓库不存在');
  }

  /** Blocks the change if `excludingId` is the only remaining active SUPER_ADMIN. */
  private async assertNotLastActiveAdmin(excludingId: string, message: string) {
    const others = await this.prisma.user.count({
      where: { role: 'SUPER_ADMIN', isActive: true, id: { not: excludingId } },
    });
    if (others === 0) throw new BadRequestException(message);
  }
}
