const { Pool } = require('pg');

const connectionString = 'postgresql://kartinet_db_user:PSo3PLaTiwKPzR0lHNJQFsyODcezYqjq@dpg-da52rkbncjis73fjp47g-a.frankfurt-postgres.render.com/kartinet_db';

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false // ضروري جداً لقواعد بيانات Render
    }
});

pool.connect()
    .then(() => console.log('✅ تم الاتصال بقاعدة بيانات MetaTron السحابية بنجاح!'))
    .catch(err => console.error('❌ فشل الاتصال بقاعدة البيانات:', err));

module.exports = pool;