import 'dotenv/config';
import { query } from '../lib/db';

async function createAdmin() {
  const email = 'admin@yeezy.ru';
  const password = 'admin_password'; // В проекте сейчас пароли в открытом виде

  console.log(`Checking/Creating admin: ${email}...`);

  try {
    // Проверяем, есть ли таблица
    await query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Вставляем админа, если его нет
    const res = await query('SELECT * FROM admins WHERE email = $1', [email]);

    if (res.rows.length === 0) {
      await query('INSERT INTO admins (email, password) VALUES ($1, $2)', [email, password]);
      console.log('✅ Admin user created successfully!');
      console.log(`Email: ${email}`);
      console.log(`Password: ${password}`);
    } else {
      console.log('ℹ️ Admin user already exists.');
    }
  } catch (error) {
    console.error('❌ Error creating admin:', error);
  } finally {
    process.exit();
  }
}

createAdmin();
