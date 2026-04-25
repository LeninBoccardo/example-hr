import { Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthenticatedUser, Role } from '../common/auth/auth.types';
import { BalanceDto } from './dto/balance.dto';

@Controller('balances')
export class BalanceController {
  constructor(private readonly service: BalanceService) {}

  @Get(':employeeId/:locationId')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN)
  async get(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BalanceDto> {
    this.authorizeAccess(user, employeeId);
    return this.service.getBalance(employeeId, locationId);
  }

  @Post(':employeeId/:locationId/refresh')
  @Roles(Role.MANAGER, Role.ADMIN)
  async refresh(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BalanceDto> {
    return this.service.refreshFromHcm(employeeId, locationId, user.userId);
  }

  private authorizeAccess(user: AuthenticatedUser, targetEmployeeId: string): void {
    if (user.role === Role.EMPLOYEE && user.employeeId !== targetEmployeeId) {
      throw new ForbiddenException('Employees may only view their own balance');
    }
  }
}
