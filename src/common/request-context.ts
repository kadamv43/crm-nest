import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';

export interface RequestContext {
  branch: string;
  userId: string;
  username: string;
  role: string;
}

/**
 * Who is calling and for which company. Always taken from the verified
 * login token, never from the request body, so one company cannot write
 * into another company's leads.
 */
export function requestContext(req: Request): RequestContext {
  const user: any = req?.user;
  const branch = user?.branch?._id ?? user?.branch;
  if (!user?.userId || !branch) {
    throw new BadRequestException('Your account is not linked to a company');
  }
  return {
    branch: String(branch),
    userId: String(user.userId),
    username: user.username,
    role: user.role,
  };
}

/**
 * The company a list/report should be limited to. Everyone except superadmin
 * is fixed to their own company; superadmin may pick one or see all.
 */
export function scopedBranch(
  req: Request,
  requested?: string,
): string | undefined {
  const user: any = req?.user;
  if (user?.role === 'superadmin') {
    return requested || undefined;
  }
  const branch = user?.branch?._id ?? user?.branch;
  return branch ? String(branch) : undefined;
}
