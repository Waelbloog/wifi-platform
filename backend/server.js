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
// 
const multer = require('multer');
const xlsx = require('xlsx');

// 💡 سر هندسي: نستخدم الذاكرة المؤقتة (Memory Storage) لأن سيرفرات Render تحذف الملفات المحفوظة عند إعادة التشغيل
const upload = multer({ storage: multer.memoryStorage() });

// مسار (API) لاستقبال ملف الإكسل من لوحة تحكم صاحب الشبكة
app.post('/api/upload-cards', upload.single('file'), async (req, res) => {
    try {
        // 1. التأكد من وجود ملف
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'الرجاء إرفاق ملف الكروت' });
        }

        // 2. استلام بيانات الشبكة والباقة من الواجهة الأمامية
        const { network_id, package_id } = req.body;

        // 3. قراءة ملف الإكسل من الذاكرة
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; // قراءة الورقة الأولى
        const sheet = workbook.Sheets[sheetName];
        
        // تحويل بيانات الإكسل إلى مصفوفة (Array) برمجية
        const cards = xlsx.utils.sheet_to_json(sheet);

        let insertedCount = 0;

        // 4. حلقة تكرارية (Loop) لحفظ الكروت في قاعدة البيانات
        for (let i = 0; i < cards.length; i++) {
            // النظام ذكي: يبحث عن عمود اسمه username أو pin أو user
            const username = cards[i].username || cards[i].pin || cards[i].user;
            const password = cards[i].password || cards[i].pass || '';

            // إذا وجد كرت، يقوم بإدخاله لقاعدة البيانات
            if (username) {
                await pool.query(
                    `INSERT INTO cards (network_id, package_id, username, password, status) 
                     VALUES ($1, $2, $3, $4, 'available')`,
                    [network_id, package_id, String(username), String(password)]
                );
                insertedCount++;
            }
        }

        // 5. الرد بنجاح العملية
        res.json({ 
            success: true, 
            message: `تم قراءة الملف بنجاح! تم حفظ ${insertedCount} كرت في قاعدة البيانات.` 
        });

    } catch (err) {
        console.error('خطأ في معالجة الملف:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء معالجة ملف الإكسل.' });
    }
});
// مسار جلب باقات متجر معين مع عدد الكروت المتاحة
app.get('/api/store-packages/:networkId', async (req, res) => {
    const { networkId } = req.params;

    try {
        // استعلام SQL ذكي يجلب الباقات ويحسب عدد الكروت المتاحة (available) لكل باقة
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
            network_name: "الماهر نت", // سيتم جلبها ديناميكياً لاحقاً
            packages: result.rows
        });

    } catch (err) {
        console.error('خطأ في جلب الباقات:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر' });
    }
});
// مسار جلب باقات المتجر
app.get('/api/store-packages/:networkId', async (req, res) => {
    const { networkId } = req.params;

    try {
        // حيلة ذكية: التأكد من وجود شبكة وباقات في قاعدة البيانات (لأغراض التجربة الأولى)
        const checkNetwork = await pool.query('SELECT * FROM networks WHERE id = 1');
        if (checkNetwork.rows.length === 0) {
            // إنشاء شبكة ميتا ترون وباقات تجريبية تلقائياً
            await pool.query(`INSERT INTO networks (id, name, slug) VALUES (1, 'ميتا ترون', 'meta-tron')`);
            await pool.query(`INSERT INTO packages (network_id, name, price, mikrotik_profile) VALUES 
                (1, 'ابو 100', 100, '1Hour'), 
                (1, 'ابو 250', 250, '10Hours'),
                (1, 'ابو 500', 500, '22Hours')`);
        }

        // الاستعلام الحقيقي لجلب الباقات وحساب عدد الكروت المتاحة
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

app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل الآن على المنفذ ${PORT}`);
});
