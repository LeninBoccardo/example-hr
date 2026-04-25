import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../config/config.schema';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig>) => ({
        secret: config.get<string>('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', { infer: true }) },
      }),
    }),
  ],
  providers: [JwtAuthGuard, RolesGuard, TokenService],
  exports: [JwtAuthGuard, RolesGuard, TokenService, JwtModule],
})
export class AuthModule {}
