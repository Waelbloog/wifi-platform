const { Pool } = require('pg');
require('dotenv').config();

// إنشاء اتصال بقاعدة البيانات باستخدام الرابط القادم من Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // ضروري جداً للاتصال بقواعد بيانات Render
    }
});

// فحص الاتصال
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.stack);
    } else {
        console.log('✅ تم الاتصال بقاعدة البيانات بنجاح!');
        release();
    }
});

module.exports = pool;