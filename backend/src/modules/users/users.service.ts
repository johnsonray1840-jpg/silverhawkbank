import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { QueryUsersDto } from './dto/query-users.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get current user's profile and account snapshot
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        kycProfile: {
          include: {
            documents: true,
          },
        },
        bankAccounts: {
          include: {
            currency: true,
          },
        },
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = user.roles.map((ur) => ur.role.name);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      phone: user.phone,
      status: user.status,
      isEmailVerified: user.isEmailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      referralCode: user.referralCode,
      profile: user.profile,
      kyc: {
        tier: user.kycProfile?.tier || 'TIER_1',
        status: user.kycProfile?.status || 'NOT_STARTED',
        reviewNotes: user.kycProfile?.reviewNotes || null,
      },
      accounts: user.bankAccounts.map((acc) => ({
        id: acc.id,
        accountNumber: acc.accountNumber,
        accountName: acc.accountName,
        type: acc.type,
        currency: acc.currencyCode,
        currentBalance: acc.currentBalance,
        availableBalance: acc.availableBalance,
        status: acc.status,
        isFrozen: acc.isFrozen,
      })),
      roles,
      createdAt: user.createdAt,
    };
  }

  /**
   * Update authenticated customer's profile
   * Sensitive profile changes (Email, Phone, Username) are protected with password/PIN verification.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isChangingSensitiveField =
      (dto.email && dto.email.toLowerCase() !== user.email) ||
      (dto.phone && dto.phone !== user.phone) ||
      (dto.username && dto.username.toLowerCase() !== user.username);

    // Verify Password or PIN if changing sensitive credentials
    if (isChangingSensitiveField) {
      let isVerified = false;
      if (dto.password) {
        isVerified = await CryptoUtil.verify(user.passwordHash, dto.password);
      } else if (dto.pin && user.pinHash) {
        isVerified = await CryptoUtil.verify(user.pinHash, dto.pin);
      }

      if (!isVerified) {
        throw new ForbiddenException(
          'Security Verification Required: Please provide your valid account password or PIN to update sensitive profile fields (email, phone, or username).',
        );
      }
    }

    // Check unique constraints for updated email/phone/username
    if (dto.phone && dto.phone !== user.phone) {
      const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('This phone number is already registered to another account');
      }
    }

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('This email address is already in use by another account');
      }
    }

    if (dto.username && dto.username.toLowerCase() !== user.username) {
      const existing = await this.prisma.user.findUnique({ where: { username: dto.username.toLowerCase() } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('This username is already taken');
      }
    }

    const { phone, email, username, password, pin, ...profileFields } = dto;

    await this.prisma.$transaction(async (tx) => {
      // 1. Update user core fields if provided
      const userUpdates: Prisma.UserUpdateInput = {};
      if (phone !== undefined) userUpdates.phone = phone;
      if (email !== undefined) {
        userUpdates.email = email.toLowerCase();
        userUpdates.isEmailVerified = false; // Require re-verification on email change
      }
      if (username !== undefined) userUpdates.username = username.toLowerCase();

      if (Object.keys(userUpdates).length > 0) {
        await tx.user.update({
          where: { id: userId },
          data: userUpdates,
        });
      }

      // 2. Update/Upsert Profile information
      const birthDate = profileFields.dateOfBirth ? new Date(profileFields.dateOfBirth) : undefined;

      await tx.profile.upsert({
        where: { userId },
        update: {
          ...profileFields,
          dateOfBirth: birthDate,
        },
        create: {
          userId,
          firstName: profileFields.firstName || '',
          lastName: profileFields.lastName || '',
          middleName: profileFields.middleName || null,
          avatarUrl: profileFields.avatarUrl || null,
          dateOfBirth: birthDate,
          gender: profileFields.gender || null,
          nationality: profileFields.nationality || null,
          addressLine1: profileFields.addressLine1 || null,
          addressLine2: profileFields.addressLine2 || null,
          city: profileFields.city || null,
          state: profileFields.state || null,
          postalCode: profileFields.postalCode || null,
          country: profileFields.country || null,
        },
      });

      // 3. Write audit log for profile change
      if (isChangingSensitiveField) {
        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorRole: 'CUSTOMER',
            action: 'SENSITIVE_PROFILE_UPDATE',
            resource: 'User',
            resourceId: userId,
            beforeState: { email: user.email, phone: user.phone, username: user.username },
            afterState: { email: dto.email || user.email, phone: dto.phone || user.phone, username: dto.username || user.username },
          },
        });
      }
    });

    return this.getProfile(userId);
  }

  /**
   * Toggle 2FA setting
   */
  async toggleTwoFactor(userId: string, enabled: boolean) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: enabled },
    });

    return {
      message: enabled ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled',
      twoFactorEnabled: enabled,
    };
  }

  /**
   * Administrative query: Paginated customer list with filters
   */
  async getUsers(queryDto: QueryUsersDto) {
    const { page = 1, limit = 20, search, status, role } = queryDto;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (role) {
      where.roles = {
        some: {
          role: {
            name: role,
          },
        },
      };
    }

    if (search) {
      where.OR = [
        { email: { contains: search } },
        { username: { contains: search } },
        { phone: { contains: search } },
        {
          profile: {
            OR: [
              { firstName: { contains: search } },
              { lastName: { contains: search } },
            ],
          },
        },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          profile: true,
          kycProfile: true,
          bankAccounts: {
            select: {
              id: true,
              accountNumber: true,
              type: true,
              currencyCode: true,
              currentBalance: true,
              availableBalance: true,
              status: true,
            },
          },
          roles: {
            include: {
              role: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      phone: u.phone,
      status: u.status,
      isEmailVerified: u.isEmailVerified,
      twoFactorEnabled: u.twoFactorEnabled,
      profile: u.profile,
      kycStatus: u.kycProfile?.status || 'NOT_STARTED',
      kycTier: u.kycProfile?.tier || 'TIER_1',
      accounts: u.bankAccounts,
      roles: u.roles.map((r) => r.role.name),
      createdAt: u.createdAt,
    }));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin view: 360-degree comprehensive customer details
   */
  async getUserDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        kycProfile: {
          include: {
            documents: true,
          },
        },
        bankAccounts: {
          include: {
            currency: true,
          },
        },
        cards: true,
        loanApplications: {
          include: {
            product: true,
          },
        },
        savingsAccounts: true,
        sessions: {
          where: { isRevoked: false },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Fetch recent transactions
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Fetch recent login history
    const loginHistory = await this.prisma.loginAttempt.findMany({
      where: { identifier: user.email },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        phone: user.phone,
        status: user.status,
        isEmailVerified: user.isEmailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        referralCode: user.referralCode,
        createdAt: user.createdAt,
        roles: user.roles.map((r) => r.role.name),
      },
      profile: user.profile,
      kyc: user.kycProfile,
      accounts: user.bankAccounts,
      cards: user.cards,
      loans: user.loanApplications,
      savings: user.savingsAccounts,
      activeSessions: user.sessions,
      recentTransactions: transactions,
      recentLogins: loginHistory,
    };
  }

  /**
   * Admin action: Freeze, suspend, or activate user account with audit trail
   */
  async updateUserStatus(userId: string, dto: UpdateUserStatusDto, adminId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const previousStatus = user.status;

    await this.prisma.$transaction(async (tx) => {
      // 1. Update User Status
      await tx.user.update({
        where: { id: userId },
        data: { status: dto.status },
      });

      // 2. If status is FROZEN or SUSPENDED, update bank accounts freeze state
      if (dto.status === 'FROZEN' || dto.status === 'SUSPENDED') {
        await tx.bankAccount.updateMany({
          where: { userId },
          data: { isFrozen: true },
        });

        // Revoke active sessions
        await tx.session.updateMany({
          where: { userId },
          data: { isRevoked: true },
        });
      } else if (dto.status === 'ACTIVE') {
        await tx.bankAccount.updateMany({
          where: { userId },
          data: { isFrozen: false },
        });
      }

      // 3. Write Immutable Audit Log
      await tx.auditLog.create({
        data: {
          actorId: adminId || null,
          actorRole: 'ADMIN',
          action: `USER_STATUS_CHANGE_${dto.status}`,
          resource: 'User',
          resourceId: userId,
          beforeState: { status: previousStatus },
          afterState: { status: dto.status, reason: dto.reason || null },
        },
      });

      // 4. Send Customer In-App Notification
      await tx.notification.create({
        data: {
          userId,
          title: `Account Status Updated: ${dto.status}`,
          message: dto.reason
            ? `Your account status has been changed to ${dto.status}. Reason: ${dto.reason}`
            : `Your account status has been changed to ${dto.status}.`,
          type: 'SECURITY',
        },
      });
    });

    return {
      message: `User status successfully changed to ${dto.status}`,
      userId,
      status: dto.status,
    };
  }
}

