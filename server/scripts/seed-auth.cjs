/**
 * Seed script to create initial organization and admin user
 *
 * Run with: node server/scripts/seed-auth.cjs
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;

async function main() {
  console.log('🌱 Seeding authentication data...\n');

  // Create default organization
  const orgSlug = 'canonical-capital';
  let organization = await prisma.organization.findUnique({
    where: { slug: orgSlug }
  });

  if (!organization) {
    organization = await prisma.organization.create({
      data: {
        name: 'Canonical Capital',
        slug: orgSlug,
        domain: 'canonical.com',
        status: 'ACTIVE'
      }
    });
    console.log('✅ Created organization:', organization.name);
  } else {
    console.log('ℹ️  Organization already exists:', organization.name);
  }

  // Create admin user
  const adminEmail = 'admin@canonical.com';
  let adminUser = await prisma.authUser.findUnique({
    where: { email: adminEmail }
  });

  if (!adminUser) {
    const passwordHash = await bcrypt.hash('admin123', SALT_ROUNDS);

    adminUser = await prisma.authUser.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: 'System Admin',
        organizationId: organization.id,
        role: 'Admin',
        status: 'ACTIVE',
        verifiedAt: new Date()
      }
    });
    console.log('✅ Created admin user:', adminUser.email);
    console.log('   Password: admin123 (change this in production!)');
  } else {
    console.log('ℹ️  Admin user already exists:', adminUser.email);
  }

  // Create a GP user for testing
  const gpEmail = 'gp@canonical.com';
  let gpUser = await prisma.authUser.findUnique({
    where: { email: gpEmail }
  });

  if (!gpUser) {
    const passwordHash = await bcrypt.hash('gp123', SALT_ROUNDS);

    gpUser = await prisma.authUser.create({
      data: {
        email: gpEmail,
        passwordHash,
        name: 'Jane GP',
        organizationId: organization.id,
        role: 'GP',
        status: 'ACTIVE',
        verifiedAt: new Date()
      }
    });
    console.log('✅ Created GP user:', gpUser.email);
    console.log('   Password: gp123');
  } else {
    console.log('ℹ️  GP user already exists:', gpUser.email);
  }

  // Create an analyst user for testing (pending verification)
  const analystEmail = 'analyst@canonical.com';
  let analystUser = await prisma.authUser.findUnique({
    where: { email: analystEmail }
  });

  if (!analystUser) {
    const passwordHash = await bcrypt.hash('analyst123', SALT_ROUNDS);

    analystUser = await prisma.authUser.create({
      data: {
        email: analystEmail,
        passwordHash,
        name: 'John Analyst',
        organizationId: organization.id,
        role: 'GP Analyst',
        status: 'PENDING'
      }
    });

    // Create verification request
    await prisma.userVerificationRequest.create({
      data: {
        userId: analystUser.id,
        requestedRole: 'GP Analyst',
        status: 'PENDING'
      }
    });

    console.log('✅ Created analyst user (pending):', analystUser.email);
    console.log('   Password: analyst123');
    console.log('   Status: PENDING (needs admin approval)');
  } else {
    console.log('ℹ️  Analyst user already exists:', analystUser.email);
  }

  console.log('\n🎉 Auth seeding complete!\n');
  console.log('Test accounts:');
  console.log('  Admin:    admin@canonical.com / admin123');
  console.log('  GP:       gp@canonical.com / gp123');
  console.log('  Analyst:  analyst@canonical.com / analyst123 (pending approval)');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
