import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '@timeoff/common/auth/jwt-auth.guard';
import { RolesGuard } from '@timeoff/common/auth/roles.guard';
import { TokenService } from '@timeoff/common/auth/token.service';
import { Role } from '@timeoff/common/auth/auth.types';
import { IS_PUBLIC_KEY } from '@timeoff/common/auth/public.decorator';
import { ROLES_KEY } from '@timeoff/common/auth/roles.decorator';

function makeCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function reflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'unit-secret', signOptions: { expiresIn: '1h' } });
  const tokens = new TokenService(jwt);

  it('allows public routes', () => {
    const guard = new JwtAuthGuard(tokens, reflector({ [IS_PUBLIC_KEY]: true }));
    expect(guard.canActivate(makeCtx({ headers: {} }))).toBe(true);
  });

  it('rejects missing bearer header', () => {
    const guard = new JwtAuthGuard(tokens, reflector({}));
    expect(() => guard.canActivate(makeCtx({ headers: {} }))).toThrow(UnauthorizedException);
  });

  it('rejects malformed bearer', () => {
    const guard = new JwtAuthGuard(tokens, reflector({}));
    expect(() => guard.canActivate(makeCtx({ headers: { authorization: 'Token abc' } }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects invalid token', () => {
    const guard = new JwtAuthGuard(tokens, reflector({}));
    expect(() =>
      guard.canActivate(makeCtx({ headers: { authorization: 'Bearer not-a-jwt' } })),
    ).toThrow(UnauthorizedException);
  });

  it('attaches user to request when token valid', () => {
    const token = tokens.sign('user-1', 'E1', Role.EMPLOYEE);
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };
    const guard = new JwtAuthGuard(tokens, reflector({}));
    expect(guard.canActivate(makeCtx(req))).toBe(true);
    expect(req.user).toMatchObject({ userId: 'user-1', employeeId: 'E1', role: 'employee' });
  });
});

describe('RolesGuard', () => {
  it('passes when no roles required', () => {
    const guard = new RolesGuard(reflector({}));
    expect(guard.canActivate(makeCtx({ user: { role: Role.EMPLOYEE } }))).toBe(true);
  });

  it('passes when public', () => {
    const guard = new RolesGuard(reflector({ [IS_PUBLIC_KEY]: true }));
    expect(guard.canActivate(makeCtx({}))).toBe(true);
  });

  it('passes when user has required role', () => {
    const guard = new RolesGuard(reflector({ [ROLES_KEY]: [Role.MANAGER] }));
    expect(guard.canActivate(makeCtx({ user: { role: Role.MANAGER } }))).toBe(true);
  });

  it('forbids when role is missing', () => {
    const guard = new RolesGuard(reflector({ [ROLES_KEY]: [Role.MANAGER] }));
    expect(() => guard.canActivate(makeCtx({ user: { role: Role.EMPLOYEE } }))).toThrow(
      ForbiddenException,
    );
  });

  it('forbids when no user', () => {
    const guard = new RolesGuard(reflector({ [ROLES_KEY]: [Role.ADMIN] }));
    expect(() => guard.canActivate(makeCtx({}))).toThrow(ForbiddenException);
  });
});
