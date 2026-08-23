const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const pool = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات الحماية والتواصل مع الواجهة الأمامية
app.use(cors());
app.use(express.json());

// 💡 إعداد Multer لاستقبال ملفات الإكسل في الذاكرة المؤقتة
const upload = multer({ storage: multer.memoryStorage() });

// ----------------------------------------------------
// 1. مسار فحص حالة السيرفر
// ----------------------------------------------------
app.get('/', (req, res) => {
    res.send('🚀 سيرفر ميتا ترون يعمل بنجاح!');
});

// ----------------------------------------------------
// 2. مسار سحري لإنشاء جداول قاعدة البيانات تلقائياً
// ----------------------------------------------------
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

// ----------------------------------------------------
// 3. مسار (API) لاستقبال ملف الإكسل من لوحة التحكم
// ----------------------------------------------------
app.post('/api/upload-cards', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'الرجاء إرفاق ملف الكروت' });
        }

        const { network_id, package_id } = req.body;
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; 
        const sheet = workbook.Sheets[sheetName];
        
        const cards = xlsx.utils.sheet_to_json(sheet);
        let insertedCount = 0;

        for (let i = 0; i < cards.length; i++) {
            const username = cards[i].username || cards[i].pin || cards[i].user;
            const password = cards[i].password || cards[i].pass || '';

            if (username) {
                await pool.query(
                    `INSERT INTO cards (network_id, package_id, username, password, status) 
                     VALUES ($1, $2, $3, $4, 'available')`,
                    [network_id, package_id, String(username), String(password)]
                );
                insertedCount++;
            }
        }

        res.json({ 
            success: true, 
            message: `تم قراءة الملف بنجاح! تم حفظ ${insertedCount} كرت في قاعدة البيانات.` 
        });

    } catch (err) {
        console.error('خطأ في معالجة الملف:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء معالجة ملف الإكسل.' });
    }
});

// ----------------------------------------------------
// 4. مسار جلب باقات المتجر (ميتا ترون)
// ----------------------------------------------------
app.get('/api/store-packages/:networkId', async (req, res) => {
    const { networkId } = req.params;

    try {
        // حيلة ذكية: التأكد من وجود شبكة وباقات في قاعدة البيانات
        const checkNetwork = await pool.query('SELECT * FROM networks WHERE id = 1');
        if (checkNetwork.rows.length === 0) {
            await pool.query(`INSERT INTO networks (id, name, slug) VALUES (1, 'ميتا ترون', 'meta-tron')`);
            await pool.query(`INSERT INTO packages (network_id, name, price, mikrotik_profile) VALUES 
                (1, 'ابو 100', 100, '1Hour'), 
                (1, 'ابو 250', 250, '10Hours'),
                (1, 'ابو 500', 500, '22Hours')`);
        }

        const query = `
            SELECT 
                p.id, 
                p.name, 
                p.price, 
                p.mikrotik_profile as volume,
                COUNT(c.id) as available_cards
            FROM packages p
            LEFT JOIN cards c ON p.id = c.package_id AND c.status = 'available'
            WHERE p.network_id = $1
            GROUP BY p.id
            ORDER BY p.price ASC;
        `;
        
        const result = await pool.query(query, [networkId]);
        
        res.json({
            success: true,
            network_name: "ميتا ترون",
            packages: result.rows
        });

    } catch (err) {
        console.error('خطأ في جلب الباقات:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر' });
    }
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`🚀 سيرفر ميتا ترون يعمل الآن على المنفذ ${PORT}`);
});