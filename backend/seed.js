import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = 
  process.env.DATABASE_URL || 
  "postgresql://pulse_admin:pulse_secure_password_2026@localhost:5432/pulse_apm_db?schema=public";

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\u{1F331} Seeding database...');

  // Hash the dev password so bcrypt.compare works during login
  const hashedPassword = await bcrypt.hash('devpassword123', 10);

  // 1. Create or ensure default dev user exists
  const user = await prisma.user.upsert({
    where: { email: 'dev@pulseapm.local' },
    update: { password: hashedPassword },
    create: {
      email: 'dev@pulseapm.local',
      password: hashedPassword,
    },
  });

  // 2. Create or ensure benchmark project exists
  const project = await prisma.project.upsert({
    where: { id: 'proj_bench_99' },
    update: {},
    create: {
      id: 'proj_bench_99',
      name: 'Benchmark Project',
      user: {
        connect: { id: user.id }
      }
    },
  });

  // 3. Insert the API key used by load-test.js
  await prisma.apiKey.upsert({
    where: { key: 'sk_bench_test_key_xyz' },
    update: {},
    create: {
      key: 'sk_bench_test_key_xyz',
      name: 'Local Dev Load Test Key',
      projectId: project.id,
    },
  });

  console.log('\u{2705} Seed complete! Dev User, Project "proj_bench_99", and API Key created.');
}

main()
  .catch((e) => {
    console.error('\u{274C} Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });