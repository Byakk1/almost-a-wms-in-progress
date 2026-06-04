import { Body, Controller, Get, Headers, Post, Put } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ok } from '../common/api-response';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return ok(await this.authService.login(body.email, body.password));
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    return ok(await this.authService.refresh(body.refreshToken));
  }

  @Post('logout')
  async logout(@Body() body: { refreshToken?: string }) {
    return ok(await this.authService.logout(body?.refreshToken));
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    return ok(await this.authService.me(authorization));
  }

  @Put('change-password')
  async changePassword(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    return ok(await this.authService.changePassword(authorization, body.oldPassword, body.newPassword));
  }
}