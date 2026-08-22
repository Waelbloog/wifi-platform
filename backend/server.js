const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات الحماية والتواصل مع الواجهة الأمامية
app.use(cors());
app.use(express.json());

// مسار تجريبي للتأكد أن السيرفر يعمل
app.get('/', (req, res) => {
    res.send('🚀 سيرفر منصة الكروت يعمل بنجاح!');
});

// مسار تجريبي لجلب الباقات من قاعدة البيانات
app.get('/api/packages', async (req, res) => {
    try {
        // سيقوم هذا الكود لاحقاً بجلب الباقات من جدول الباقات
        // const result = await pool.query('SELECT * FROM packages');
        // res.json(result.rows);
        
        res.json([
            { id: 1, name: 'ابو 100', price: 100, volume: '400MB' },
            { id: 2, name: 'ابو 250', price: 250, volume: '999MB' }
        ]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});
// مسار سحري لإنشاء جداول قاعدة البيانات تلقائياً
app.get('/setup-db', async (req, res) => {
    const createTablesQuery = `
        -- جدول الشبكات
        CREATE TABLE IF NOT EXISTS networks (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            slug VARCHAR(100) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- جدول الباقات
        CREATE TABLE IF NOT EXISTS packages (
            id SERIAL PRIMARY KEY,
            network_id INTEGER REFERENCES networks(id),
            name VARCHAR(100) NOT NULL,
            price DECIMAL(10, 2) NOT NULL,
            mikrotik_profile VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- جدول الكروت
        CREATE TABLE IF NOT EXISTS cards (
            id SERIAL PRIMARY KEY,
            network_id INTEGER REFERENCES networks(id),
            package_id INTEGER REFERENCES packages(id),
            username VARCHAR(50) NOT NULL,
            password VARCHAR(50),
            status VARCHAR(20) DEFAULT 'available',
            sold_at TIMESTAMP
        );

        -- جدول العمليات المالية
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            network_id INTEGER REFERENCES networks(id),
            card_id INTEGER REFERENCES cards(id),
            customer_phone VARCHAR(20),
            amount DECIMAL(10, 2),
            wallet_provider VARCHAR(50),
            provider_txn_id VARCHAR(100) UNIQUE,
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    try {
        await pool.query(createTablesQuery);
        res.send('✅ تم إنشاء جميع جداول قاعدة البيانات بنجاح! المنصة جاهزة الآن.');
    } catch (err) {
        console.error(err);
        res.status(500).send('❌ حدث خطأ أثناء إنشاء الجداول: ' + err.message);
    }
});
// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل الآن على المنفذ ${PORT}`);
});
