import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { jwtSecret } from '../common/secrets';

@Module({
  imports: [
    // Lazy factory so the secret is read during DI bootstrap, after ConfigModule
    // has loaded .env (this module's decorator runs before that when imported).
    JwtModule.registerAsync({
      useFactory: () => ({ secret: jwtSecret() }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}