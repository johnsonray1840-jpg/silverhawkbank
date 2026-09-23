import { PrismaClient, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const getArg = (key: string, fallback: string) => {
    const found = args.find((a) => a.startsWith(`${key}=`));
    return found ? found.split('=')[1] : fallback;
  };

  const email = getArg('email', process.env.ADMIN_EMAIL || 'admin@silverhawkbank.com');
  const password = getArg('password', process.env.ADMIN_PASSWORD || 'SilverhawkAdmin2026!');
  const username = getArg('username', email.split('@')[0]);
  const roleName = getArg('role', 'SUPER_ADMIN').toUpperCase();
  const firstName = getArg('firstName', 'Admin');
  const lastName = getArg('lastName', 'User');
  const pin = getArg('pin', '1234');

  console.log('================================================================');
  console.log(`🛡️  Creating / Updating Admin Account in Database`);
  console.log(`📧 Email:    ${email}`);
  console.log(`👤 Username: ${username}`);
  console.log(`👑 Role:     ${roleName}`);
  console.log(`🔒 PIN:      ${pin}`);
  console.log('================================================================\n');

  // 1. Ensure Super Admin / Admin Role Exists
  let role = await prisma.role.findUnique({
    where: { name: roleName },
  });

  if (!role) {
    console.log(`⚠️  Role '${roleName}' not found. Creating it with full administrative permissions...`);
    role = await prisma.role.create({
      data: {
        name: roleName,
        description: `Full access ${roleName} role`,
        isSystem: true,
      },
    });
  }

  // 2. Hash Password and PIN
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  const pinHash = await argon2.hash(pin, {
    type: argon2.argon2id,
  });

  // 3. Create or update user
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username,
      passwordHash,
      pinHash,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
    },
    create: {
      email,
      username,
      passwordHash,
      pinHash,
      status: UserStatus.ACTIVE,
      isEmailVerified: true,
      referralCode: `REF-${username.toUpperCase()}`,
      profile: {
        create: {
          firstName,
          lastName,
          country: 'United States',
        },
      },
    },
    include: { profile: true },
  });

  // 4. Attach Role to User
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
    },
  });

  console.log('✅ Admin Account Ready!');
  console.log('----------------------------------------------------------------');
  console.log(`Email:    ${user.email}`);
  console.log(`Password: ${password}`);
  console.log(`PIN:      ${pin}`);
  console.log(`Role:     ${role.name}`);
  console.log('----------------------------------------------------------------\n');
}

main()
  .catch((e) => {
    console.error('❌ Failed to create admin user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
