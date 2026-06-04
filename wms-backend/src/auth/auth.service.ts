import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

type SafeUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  warehouseId: string | null;
};

@Injectable()
export class AuthService {
  private readonly refreshTokens = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.passwordHash !== password) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const accessToken = this.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      warehouseId: user.warehouseId,
    });
    const refreshToken = this.signRefreshToken(user.id);
    this.refreshTokens.set(refreshToken, user.id);

    return {
      accessToken,
      refreshToken,
      user: this.toSafeUser({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        warehouseId: user.warehouseId,
      }),
    };
  }

  async refresh(refreshToken: string) {
    const userId = this.refreshTokens.get(refreshToken);
    if (!userId) {
      throw new UnauthorizedException('refresh_token 无效');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const accessToken = this.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      warehouseId: user.warehouseId,
    });
    const newRefreshToken = this.signRefreshToken(user.id);

    this.refreshTokens.delete(refreshToken);
    this.refreshTokens.set(newRefreshToken, user.id);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: this.toSafeUser({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        warehouseId: user.warehouseId,
      }),
    };
  }

  logout(refreshToken?: string) {
    if (refreshToken) {
      this.refreshTokens.delete(refreshToken);
    }
    return true;
  }

  async me(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 Bearer token');
    }

    const token = authorization.replace('Bearer ', '');
    const payload = this.jwtService.verify(token, {
      secret: process.env.JWT_SECRET || 'wms-dev-secret',
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub as string },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return this.toSafeUser({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      warehouseId: user.warehouseId,
    });
  }

  async changePassword(
    authorization: string | undefined,
    oldPassword: string,
    newPassword: string,
  ) {
    const me = await this.me(authorization);

    const user = await this.prisma.user.findUnique({
      where: { id: me.id },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    if (user.passwordHash !== oldPassword) {
      throw new UnauthorizedException('旧密码错误');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPassword },
    });

    return true;
  }

  private signAccessToken(user: {
    id: string;
    email: string;
    role: Role;
    warehouseId: string | null;
  }) {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        warehouseId: user.warehouseId,
      },
      {
        secret: process.env.JWT_SECRET || 'wms-dev-secret',
        expiresIn: '7d',
      },
    );
  }

  private signRefreshToken(userId: string) {
    return this.jwtService.sign(
      {
        sub: userId,
        type: 'refresh',
      },
      {
        secret: process.env.JWT_REFRESH_SECRET || 'wms-dev-refresh-secret',
        expiresIn: '30d',
      },
    );
  }

  private toSafeUser(user: SafeUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      warehouseId: user.warehouseId,
    };
  }
}