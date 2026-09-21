import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  AccountType,
  KycStatus,
  KycTier,
  LedgerAccountType,
  OtpType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { TotpUtil } from '../../common/utils/totp.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { Enable2faDto } from './dto/enable-2fa.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  /**
   * Register a new customer through the multi-step onboarding wizard
   */
  async register(dto: RegisterDto, ipAddress?: string, userAgent?: string) {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('Passwords do not match');
    }

    // Check unique constraints
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('An account with this email already exists');
    }

    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existingUsername) {
      throw new ConflictException('This username is already taken');
    }

    if (dto.phone) {
      const existingPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (existingPhone) {
        throw new ConflictException('This phone number is already registered');
      }
    }

    // Check referral code if supplied
    let referrerId: string | null = null;
    if (dto.referralCode) {
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode },
      });
      if (referrer) {
        referrerId = referrer.id;
      }
    }

    // Hash password and PIN with Argon2id
    const pinVal = dto.pin || '1234';
    const passwordHash = await CryptoUtil.hash(dto.password);
    const pinHash = await CryptoUtil.hash(pinVal);

    // Ensure Currency exists in database (find or upsert dynamically)
    const rawCurrency = (dto.currency || 'USD').toUpperCase();
    const currencyNameMap: Record<string, { name: string; symbol: string }> = {
      EUR: { name: 'Euro', symbol: '€' },
      GBP: { name: 'British Pound', symbol: '£' },
      CAD: { name: 'Canadian Dollar', symbol: 'CA$' },
      AUD: { name: 'Australian Dollar', symbol: 'AU$' },
      JPY: { name: 'Japanese Yen', symbol: '¥' },
      CHF: { name: 'Swiss Franc', symbol: 'CHF' },
      NGN: { name: 'Nigerian Naira', symbol: '₦' },
      USD: { name: 'US Dollar', symbol: '$' },
      AED: { name: 'UAE Dirham', symbol: 'د.إ' },
      INR: { name: 'Indian Rupee', symbol: '₹' },
      ZAR: { name: 'South African Rand', symbol: 'R' },
      BRL: { name: 'Brazilian Real', symbol: 'R$' },
      SGD: { name: 'Singapore Dollar', symbol: '$' },
      NZD: { name: 'New Zealand Dollar', symbol: '$' },
      CNY: { name: 'Chinese Yuan', symbol: '¥' },
      SAR: { name: 'Saudi Riyal', symbol: '﷼' },
      QAR: { name: 'Qatari Riyal', symbol: '﷼' },
      KWD: { name: 'Kuwaiti Dinar', symbol: 'د.ك' },
      BHD: { name: 'Bahraini Dinar', symbol: '.د.ب' },
      OMR: { name: 'Omani Rial', symbol: '﷼' },
    };

    const currencyMeta = currencyNameMap[rawCurrency] || { name: `${rawCurrency} Currency`, symbol: rawCurrency };
    const currency = await this.prisma.currency.upsert({
      where: { code: rawCurrency },
      update: {},
      create: {
        code: rawCurrency,
        name: currencyMeta.name,
        symbol: currencyMeta.symbol,
        decimals: rawCurrency === 'JPY' ? 0 : 2,
        isActive: true,
        isBase: false,
      },
    });
    const currencyCode = currency.code;
    const accountType = dto.accountType || AccountType.CHECKING;
    const country = dto.country || 'United States of America';

    // Find CUSTOMER role
    let customerRole = await this.prisma.role.findUnique({ where: { name: 'CUSTOMER' } });
    if (!customerRole) {
      customerRole = await this.prisma.role.create({
        data: {
          name: 'CUSTOMER',
          description: 'Standard consumer banking portal user',
          isSystem: true,
        },
      });
    }

    // Generate unique account number and referral code
    const accountNumber = CryptoUtil.generateAccountNumber();
    const userReferralCode = `REF-${dto.username.toUpperCase()}`;

    // Execute atomic registration in MySQL transaction
    const newUser = await this.prisma.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username.toLowerCase(),
          phone: dto.phone || null,
          passwordHash,
          pinHash,
          status: UserStatus.ACTIVE,
          isEmailVerified: false,
          referralCode: userReferralCode,
          referredById: referrerId,
          profile: {
            create: {
              firstName: dto.firstName,
              lastName: dto.lastName,
              middleName: dto.middleName || null,
              country,
            },
          },
          kycProfile: {
            create: {
              tier: KycTier.TIER_1,
              status: KycStatus.NOT_STARTED,
            },
          },
          roles: {
            create: {
              roleId: customerRole.id,
            },
          },
        },
        include: {
          profile: true,
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      // 2. Create Default Primary Bank Account
      const bankAccount = await tx.bankAccount.create({
        data: {
          userId: user.id,
          accountNumber,
          accountName: `${dto.firstName} ${dto.lastName} - ${accountType}`,
          type: accountType,
          currencyCode,
          status: AccountStatus.ACTIVE,
          currentBalance: 0.0000,
          availableBalance: 0.0000,
          ledgerBalance: 0.0000,
        },
      });

      // 3. Create Corresponding Liability Ledger Account in Chart of Accounts
      await tx.ledgerAccount.create({
        data: {
          accountCode: `2010-${accountNumber}`,
          name: `Liability - ${bankAccount.accountName}`,
          type: LedgerAccountType.LIABILITY,
          currencyCode,
          bankAccountId: bankAccount.id,
        },
      });

      // 4. Create In-App Welcome Notification
      await tx.notification.create({
        data: {
          userId: user.id,
          title: 'Welcome to Silverhawk',
          message: `Your account #${accountNumber} is active. Complete KYC verification to unlock higher transaction limits.`,
          type: 'WELCOME',
        },
      });

      return { user, bankAccount };
    });

    // 5. Generate 6-digit Email Verification OTP code and store in DB
    const otpCode = CryptoUtil.generateNumericOtp(6);
    await this.prisma.otpVerification.create({
      data: {
        identifier: newUser.user.email,
        code: otpCode,
        type: OtpType.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      },
    });

    // 6. Asynchronously send 6-digit Verification Email via Resend / SMTP
    this.emailService
      .sendVerificationOtpEmail({
        to: newUser.user.email,
        recipientName: `${dto.firstName} ${dto.lastName}`,
        otpCode,
        expiresInMinutes: 15,
      })
      .catch((err) => {
        this.logger.warn(`⚠️ Failed to dispatch registration OTP email to ${newUser.user.email}: ${err.message}`);
      });

    // Generate initial tokens & session
    const tokens = await this.generateTokens(newUser.user.id, newUser.user.email, newUser.user.username, ['CUSTOMER']);
    await this.createSession(newUser.user.id, tokens.refreshToken, ipAddress, userAgent);

    return {
      message: 'Account registered successfully. A 6-digit verification code has been dispatched to your email.',
      requiresVerification: true,
      email: newUser.user.email,
      user: {
        id: newUser.user.id,
        email: newUser.user.email,
        username: newUser.user.username,
        isEmailVerified: false,
        profile: newUser.user.profile,
        account: {
          accountNumber: newUser.bankAccount.accountNumber,
          accountName: newUser.bankAccount.accountName,
          type: newUser.bankAccount.type,
          currency: newUser.bankAccount.currencyCode,
          balance: newUser.bankAccount.currentBalance,
        },
        roles: ['CUSTOMER'],
      },
      tokens,
    };
  }

  /**
   * Authenticate user with Email or Username and Password
   */
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const identifier = dto.identifier.trim().toLowerCase();

    // Check brute-force threshold in login_attempts (max 5 failed attempts in last 15 minutes)
    const recentFailures = await this.prisma.loginAttempt.count({
      where: {
        identifier,
        successful: false,
        createdAt: {
          gte: new Date(Date.now() - 15 * 60 * 1000),
        },
      },
    });

    if (recentFailures >= 5) {
      throw new ForbiddenException(
        'Too many failed login attempts. Account temporarily locked for 15 minutes.',
      );
    }

    // Find User by email or username
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
      },
      include: {
        profile: true,
        bankAccounts: {
          where: { status: AccountStatus.ACTIVE },
          take: 1,
        },
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      await this.recordLoginAttempt(identifier, false, ipAddress, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify Password with Argon2id
    const isPasswordValid = await CryptoUtil.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      await this.recordLoginAttempt(identifier, false, ipAddress, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check account status
    if (user.status === UserStatus.FROZEN) {
      throw new ForbiddenException('Your account has been frozen. Please contact customer support.');
    }
    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.CLOSED) {
      throw new ForbiddenException('Your account is currently inactive.');
    }

    // Record successful login attempt
    await this.recordLoginAttempt(identifier, true, ipAddress, userAgent);

    const recipientName = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : user.username;

    // Check 2FA requirement
    if (user.twoFactorEnabled) {
      // Invalidate any previous unused 2FA OTPs for this account to prevent race conditions
      await this.prisma.otpVerification.updateMany({
        where: {
          identifier: user.email,
          type: OtpType.LOGIN_2FA,
          isUsed: false,
        },
        data: { isUsed: true },
      });

      const otpCode = CryptoUtil.generateNumericOtp(6);
      await this.prisma.otpVerification.create({
        data: {
          identifier: user.email,
          code: otpCode,
          type: OtpType.LOGIN_2FA,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        },
      });

      this.emailService
        .sendTwoFactorOtpEmail({
          to: user.email,
          recipientName,
          otpCode,
          expiresInMinutes: 15,
        })
        .catch((err) => {
          this.logger.warn(`⚠️ Failed to dispatch 2FA email: ${err.message}`);
        });

      return {
        requires2fa: true,
        requiresVerification: false,
        message: 'Two-factor authentication required. A 6-digit security code has been sent to your email.',
        email: user.email,
      };
    }

    // Check unverified email requirement
    if (!user.isEmailVerified) {
      const otpCode = CryptoUtil.generateNumericOtp(6);
      await this.prisma.otpVerification.create({
        data: {
          identifier: user.email,
          code: otpCode,
          type: OtpType.EMAIL_VERIFICATION,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        },
      });

      this.emailService
        .sendVerificationOtpEmail({
          to: user.email,
          recipientName,
          otpCode,
          expiresInMinutes: 15,
        })
        .catch((err) => {
          this.logger.warn(`⚠️ Failed to dispatch verification email: ${err.message}`);
        });

      return {
        requiresVerification: true,
        requires2fa: false,
        message: 'Please verify your email address. A 6-digit code has been dispatched to your inbox.',
        email: user.email,
      };
    }

    // Extract roles & permissions
    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.slug),
        ),
      ),
    );

    const tokens = await this.generateTokens(user.id, user.email, user.username, roles);
    await this.createSession(user.id, tokens.refreshToken, ipAddress, userAgent);

    return {
      message: 'Logged in successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isEmailVerified: user.isEmailVerified,
        profile: user.profile,
        primaryAccount: user.bankAccounts[0] || null,
        roles,
        permissions,
      },
      tokens,
    };
  }

  /**
   * Refresh expired access token with rotating refresh token
   */
  async refreshToken(refreshToken: string, ipAddress?: string, userAgent?: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: {
        user: {
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException('INVALID_OR_EXPIRED_REFRESH_TOKEN');
    }

    const roles = session.user.roles.map((ur) => ur.role.name);
    const tokens = await this.generateTokens(session.user.id, session.user.email, session.user.username, roles);

    // Rotate refresh token in session
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshToken: tokens.refreshToken,
        ipAddress: ipAddress || session.ipAddress,
        userAgent: userAgent || session.userAgent,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      message: 'Tokens refreshed successfully',
      tokens,
    };
  }

  /**
   * Log out and revoke active refresh session
   */
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: { userId, refreshToken },
        data: { isRevoked: true },
      });
    } else {
      await this.prisma.session.updateMany({
        where: { userId },
        data: { isRevoked: true },
      });
    }

    return { message: 'Logged out successfully' };
  }

  /**
   * Request password reset token / link
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) {
      // Return success to prevent email enumeration
      return {
        message: 'If an account exists with this email, a password reset link has been dispatched.',
      };
    }

    const resetToken = CryptoUtil.generateSecureToken(32);
    await this.prisma.otpVerification.create({
      data: {
        identifier: user.email,
        code: resetToken,
        type: OtpType.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    return {
      message: 'If an account exists with this email, a password reset link has been dispatched.',
      resetToken, // Provided in development for easy testing
    };
  }

  /**
   * Reset user password using token
   */
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('Passwords do not match');
    }

    const verification = await this.prisma.otpVerification.findFirst({
      where: {
        code: dto.token,
        type: OtpType.PASSWORD_RESET,
        isUsed: false,
        expiresAt: { gte: new Date() },
      },
    });

    if (!verification) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: verification.identifier },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const newPasswordHash = await CryptoUtil.hash(dto.password);

    await this.prisma.$transaction([
      // Update password
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash },
      }),
      // Mark OTP as used
      this.prisma.otpVerification.update({
        where: { id: verification.id },
        data: { isUsed: true },
      }),
      // Invalidate all existing sessions
      this.prisma.session.updateMany({
        where: { userId: user.id },
        data: { isRevoked: true },
      }),
    ]);

    return { message: 'Password has been reset successfully. You can now log in.' };
  }

  /**
   * Resend a fresh 6-digit verification or 2FA OTP code
   */
  async resendOtp(dto: ResendOtpDto) {
    const identifier = dto.identifier.trim().toLowerCase();
    const type = dto.type || OtpType.EMAIL_VERIFICATION;

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
      },
      include: { profile: true },
    });

    if (!user) {
      return {
        success: true,
        message: 'If an account exists with this email, a new 6-digit verification code has been dispatched.',
      };
    }

    // Invalidate prior active OTPs for this identifier and type
    await this.prisma.otpVerification.updateMany({
      where: {
        identifier: user.email,
        type,
        isUsed: false,
      },
      data: { isUsed: true },
    });

    const otpCode = CryptoUtil.generateNumericOtp(6);
    await this.prisma.otpVerification.create({
      data: {
        identifier: user.email,
        code: otpCode,
        type,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      },
    });

    const recipientName = user.profile
      ? `${user.profile.firstName} ${user.profile.lastName}`
      : user.username;

    if (type === OtpType.LOGIN_2FA) {
      await this.emailService.sendTwoFactorOtpEmail({
        to: user.email,
        recipientName,
        otpCode,
        expiresInMinutes: 10,
      });
    } else {
      await this.emailService.sendVerificationOtpEmail({
        to: user.email,
        recipientName,
        otpCode,
        expiresInMinutes: 15,
      });
    }

    return {
      success: true,
      message: 'A fresh 6-digit verification code has been dispatched to your email.',
    };
  }

  /**
   * Verify an OTP code, activate email, and return full authentication session
   */
  async verifyOtp(dto: VerifyOtpDto, ipAddress?: string, userAgent?: string) {
    const rawIdentifier = (dto.identifier || dto.email || '').trim().toLowerCase();
    if (!rawIdentifier) {
      throw new BadRequestException('Email or identifier is required');
    }

    const code = dto.code.trim();

    // Resolve user by email or username
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: rawIdentifier }, { username: rawIdentifier }],
      },
      include: {
        profile: true,
        bankAccounts: {
          where: { status: AccountStatus.ACTIVE },
          take: 1,
        },
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const canonicalEmail = user ? user.email : rawIdentifier;
    const typeFilter = dto.type
      ? { in: [dto.type, OtpType.LOGIN_2FA, OtpType.EMAIL_VERIFICATION] }
      : { in: [OtpType.LOGIN_2FA, OtpType.EMAIL_VERIFICATION] };

    const otp = await this.prisma.otpVerification.findFirst({
      where: {
        OR: [
          { identifier: canonicalEmail },
          { identifier: rawIdentifier },
        ],
        code,
        type: typeFilter,
        isUsed: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException('Invalid or expired 6-digit verification code. Please check your email or request a new code.');
    }

    await this.prisma.otpVerification.update({
      where: { id: otp.id },
      data: { isUsed: true },
    });

    // Mark email verified
    await this.prisma.user.updateMany({
      where: { email: canonicalEmail },
      data: { isEmailVerified: true },
    });

    if (!user) {
      return { message: 'Verification successful', verified: true };
    }

    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.slug),
        ),
      ),
    );

    const tokens = await this.generateTokens(user.id, user.email, user.username, roles);
    await this.createSession(user.id, tokens.refreshToken, ipAddress, userAgent);

    return {
      message: 'Verification successful! Welcome to Silverhawk.',
      verified: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isEmailVerified: true,
        profile: user.profile,
        primaryAccount: user.bankAccounts[0] || null,
        roles,
        permissions,
      },
      tokens,
    };
  }

  /**
   * Change user password while authenticated
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.newPasswordConfirmation) {
      throw new BadRequestException('New passwords do not match');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isCurrentValid = await CryptoUtil.verify(user.passwordHash, dto.currentPassword);
    if (!isCurrentValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newPasswordHash = await CryptoUtil.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * Change user transaction PIN
   */
  async changePin(userId: string, dto: ChangePinDto) {
    if (dto.newPin !== dto.newPinConfirmation) {
      throw new BadRequestException('New PIN confirmation does not match');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.pinHash && dto.currentPin) {
      const isPinValid = await CryptoUtil.verify(user.pinHash, dto.currentPin);
      if (!isPinValid) {
        throw new BadRequestException('Current PIN is incorrect');
      }
    }

    const newPinHash = await CryptoUtil.hash(dto.newPin);
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: newPinHash },
    });

    return { message: 'Transaction PIN updated successfully' };
  }

  /**
   * Generate RFC 6238 TOTP Secret & Backup Recovery Codes
   */
  async generate2faSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const secret = TotpUtil.generateSecret(20);
    const keyUri = TotpUtil.generateKeyUri(user.email, secret);
    const backupCodes = TotpUtil.generateBackupCodes(10);

    return {
      secret,
      keyUri,
      backupCodes,
      instructions: 'Scan the QR code or enter the secret in Google Authenticator or Authy. Store backup codes safely.',
    };
  }

  /**
   * Verify token and enable Two-Factor Authentication
   */
  async enable2fa(userId: string, dto: Enable2faDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isValid = TotpUtil.verifyTotp(dto.code, dto.secret);
    if (!isValid) {
      throw new BadRequestException('Invalid 6-digit TOTP code. Please check your authenticator app.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: dto.secret,
      },
    });

    return {
      message: 'Two-factor authentication enabled successfully',
      twoFactorEnabled: true,
    };
  }

  /**
   * Disable Two-Factor Authentication with Password and Token
   */
  async disable2fa(userId: string, dto: Disable2faDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await CryptoUtil.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (user.twoFactorSecret) {
      const isTokenValid = TotpUtil.verifyTotp(dto.code, user.twoFactorSecret);
      if (!isTokenValid) {
        throw new BadRequestException('Invalid 2FA code');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });

    return {
      message: 'Two-factor authentication disabled successfully',
      twoFactorEnabled: false,
    };
  }

  /**
   * Verify 2FA challenge during login
   */
  async verify2fa(dto: Verify2faDto, ipAddress?: string, userAgent?: string) {
    const identifier = dto.identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }, { id: identifier }],
      },
      include: {
        profile: true,
        bankAccounts: {
          where: { status: AccountStatus.ACTIVE },
          take: 1,
        },
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    let isValid = false;

    // 1. Check TOTP Secret
    if (user.twoFactorSecret) {
      isValid = TotpUtil.verifyTotp(dto.code, user.twoFactorSecret);
    }

    // 2. If not valid, check Email/SMS OTP
    if (!isValid) {
      const otp = await this.prisma.otpVerification.findFirst({
        where: {
          identifier: user.email,
          code: dto.code,
          type: OtpType.LOGIN_2FA,
          isUsed: false,
          expiresAt: { gte: new Date() },
        },
      });

      if (otp) {
        isValid = true;
        await this.prisma.otpVerification.update({
          where: { id: otp.id },
          data: { isUsed: true },
        });
      }
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired two-factor authentication code');
    }

    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.slug),
        ),
      ),
    );

    const tokens = await this.generateTokens(user.id, user.email, user.username, roles);
    await this.createSession(user.id, tokens.refreshToken, ipAddress, userAgent);

    return {
      message: '2FA authentication successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isEmailVerified: user.isEmailVerified,
        profile: user.profile,
        primaryAccount: user.bankAccounts[0] || null,
        roles,
        permissions,
      },
      tokens,
    };
  }

  // ----------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ----------------------------------------------------------------------------

  private async generateTokens(userId: string, email: string, username: string, roles: string[]) {
    const payload = { sub: userId, email, username, roles };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET', 'super-secret-jwt-key-change-in-production-silverhawk-banking-2026'),
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '900s'),
    });

    const refreshToken = CryptoUtil.generateSecureToken(32);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    };
  }

  private async createSession(userId: string, refreshToken: string, ipAddress?: string, userAgent?: string) {
    return this.prisma.session.create({
      data: {
        userId,
        refreshToken,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
  }

  private async recordLoginAttempt(identifier: string, successful: boolean, ipAddress?: string, userAgent?: string) {
    try {
      await this.prisma.loginAttempt.create({
        data: {
          identifier,
          successful,
          ipAddress: ipAddress || '127.0.0.1',
          userAgent: userAgent || 'Unknown',
        },
      });
    } catch (e) {
      this.logger.error('Failed to record login attempt:', e);
    }
  }
}

