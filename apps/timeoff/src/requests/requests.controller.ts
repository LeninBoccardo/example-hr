import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { CancelRequestDto, RejectRequestDto, RequestDto } from './dto/request.dto';
import { Roles } from '../common/auth/roles.decorator';
import { Role, AuthenticatedUser } from '../common/auth/auth.types';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { RequestStatus } from '../domain/request';

@Controller('requests')
export class RequestsController {
  constructor(private readonly service: RequestsService) {}

  @Post()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN)
  create(
    @Body() dto: CreateRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<RequestDto> {
    return this.service.create(user.userId, user.employeeId, dto, idempotencyKey ?? null);
  }

  @Get(':id')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN)
  async get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RequestDto> {
    const row = await this.service.get(id);
    if (user.role === Role.EMPLOYEE && row.employeeId !== user.employeeId) {
      throw new ForbiddenException('Employees may only view their own requests');
    }
    return row;
  }

  @Get()
  @Roles(Role.MANAGER, Role.ADMIN)
  list(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: RequestStatus,
  ): Promise<RequestDto[]> {
    return this.service.list({ employeeId, status });
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER, Role.ADMIN)
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RequestDto> {
    return this.service.approve(id, user.userId);
  }

  @Post(':id/reject')
  @Roles(Role.MANAGER, Role.ADMIN)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RequestDto> {
    return this.service.reject(id, user.userId, dto.reason);
  }

  @Post(':id/cancel')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN)
  cancel(
    @Param('id') id: string,
    @Body() _dto: CancelRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RequestDto> {
    return this.service.cancel(id, user.userId, user.employeeId, user.role);
  }
}
