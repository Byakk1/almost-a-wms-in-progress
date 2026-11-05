import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { jwtSecret } from '../secrets';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const authorization = req.headers['authorization'];

    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 Bearer token');
    }

    const token = authorization.replace('Bearer ', '');
    let payload: { sub?: string };
    try {
      payload = this.jwtService.verify(token, { secret: jwtSecret() });
    } catch {
      throw new UnauthorizedException('token 无效或已过期');
    }

    // A JWT is valid for 7 days, but "deactivate" has to take effect now, not at
    // expiry. One primary-key lookup per request buys an immediate lock-out; the
    // same check also rejects tokens for users that no longer exist.
    const live = await this.prisma.user.findUnique({
      where: { id: payload.sub ?? '' },
      select: { isActive: true },
    });
    if (!live?.isActive) {
      throw new UnauthorizedException('账号已停用或不存在');
    }

    req.user = payload;
    return true;
  }
}
