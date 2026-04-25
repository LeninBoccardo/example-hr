import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload, Role } from './auth.types';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(userId: string, employeeId: string, role: Role): string {
    const payload: JwtPayload = { sub: userId, employeeId, role };
    return this.jwt.sign(payload);
  }

  verify(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token);
  }
}
