export enum Role {
  EMPLOYEE = 'employee',
  MANAGER = 'manager',
  ADMIN = 'admin',
}

export interface JwtPayload {
  sub: string; // user id
  employeeId: string; // canonical employee id this user represents
  role: Role;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  userId: string;
  employeeId: string;
  role: Role;
}
