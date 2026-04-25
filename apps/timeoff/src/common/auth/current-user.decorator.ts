import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedUser } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthenticatedUser;
  },
);
