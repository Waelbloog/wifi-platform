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

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل الآن على المنفذ ${PORT}`);
});