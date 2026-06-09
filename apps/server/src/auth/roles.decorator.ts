import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@cloth-scan/shared";

export const ROLES_KEY = "roles";

/** 限定可访问的角色：@Roles("owner") */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
