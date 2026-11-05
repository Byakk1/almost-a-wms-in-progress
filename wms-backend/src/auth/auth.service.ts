import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { jwtRefreshSecret, jwtSecret } from '../common/secrets';

/**
 * Cost factor for password hashing. 10 is the common default — ~50ms per hash on
 * commodity hardware, which is slow enough to make offline cracking expensive and
 * fast enough not to be a login bottleneck.
 *
 * NOTE: `User.passwordHash` previously stored the password in CLEARTEXT despite the
 * column name, and was compared with `!==`. Existing rows must be migrated with
 * `scripts/hash-existing-passwords.ts` before this code can authenticate them;
 * there is deliberately no plaintext fallback, since one would keep accepting
 * unhashed values indefinitely and negate the fix.
 */
const BCRYPT_ROUNDS = 10;

/**
 * A syntactically valid bcrypt digest that no password matches, used to keep login
 * timing constant when the email is unknown. Generating it once at module load costs
 * a single hash; comparing against it costs the same as a real comparison.
 */
const DUMMY_HASH = bcrypt.hashSync('__no_such_password__', BCRYPT_ROUNDS);

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
      where: { email: email.trim().toLowerCase() },
    });

    // A disabled account reports exactly the same failure as a wrong password —
    // telling an attacker "this account exists but is disabled" is a free hint.
    // bcrypt.compare still runs against a fixed dummy digest when there is no user,
    // so response timing does not reveal account existence either.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const passwordOk = await bcrypt.compare(password, hash);
    if (!user || !user.isActive || !passwordOk) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    // The one write on the login path: last successful login, for the admin list.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

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
    if (!user || !user.isActive) {
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
      secret: jwtSecret(),
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
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new UnauthorizedException('旧密码错误');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
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
        secret: jwtSecret(),
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
        secret: jwtRefreshSecret(),
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