const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs'); // مكتبة التشفير
const jwt = require('jsonwebtoken'); // مكتبة تصاريح الدخول
const pool = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'metatron_super_secret_key_2026'; // مفتاح التشفير

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get('/', (req, res) => {
    res.send('🚀 سيرفر منصة ميتا ترون (SaaS) يعمل بنجاح!');
});

// ----------------------------------------------------
// 1. مسار إعادة بناء قاعدة البيانات لنظام SaaS (حذاري: سيمسح البيانات القديمة)
// ----------------------------------------------------
app.get('/setup-db', async (req, res) => {
    const createTablesQuery = `
        DROP TABLE IF EXISTS transactions, cards, packages, networks CASCADE;

        CREATE TABLE networks (
            id SERIAL PRIMARY KEY,
            owner_name VARCHAR(100) NOT NULL,
            email VARCHAR(150) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            network_name VARCHAR(100) NOT NULL,
            slug VARCHAR(100) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE packages (
            id SERIAL PRIMARY KEY,
            network_id INTEGER REFERENCES networks(id),
            name VARCHAR(100) NOT NULL,
            price DECIMAL(10, 2) NOT NULL,
            mikrotik_profile VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE cards (
            id SERIAL PRIMARY KEY,
            network_id INTEGER REFERENCES networks(id),
            package_id INTEGER REFERENCES packages(id),
            username VARCHAR(50) NOT NULL,
            password VARCHAR(50),
            status VARCHAR(20) DEFAULT 'available',
            sold_at TIMESTAMP
        );

        CREATE TABLE transactions (
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
        res.send('✅ تم إعادة بناء النظام بالكامل بنجاح ليصبح منصة SaaS متعددة الشبكات!');
    } catch (err) {
        console.error(err);
        res.status(500).send('❌ حدث خطأ أثناء بناء الجداول: ' + err.message);
    }
});

// ----------------------------------------------------
// 2. نظام الحسابات (تسجيل صاحب شبكة جديد)
// ----------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    const { owner_name, email, password, network_name } = req.body;

    try {
        // فحص ما إذا كان الإيميل مسجلاً مسبقاً
        const checkEmail = await pool.query('SELECT * FROM networks WHERE email = $1', [email]);
        if (checkEmail.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'هذا البريد الإلكتروني مسجل مسبقاً!' });
        }

        // تشفير كلمة المرور
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // توليد رابط مخصص للشبكة (Slug)
        // مثال: "الماهر نت" ستصبح "الماهر-نت-123" لضمان عدم التكرار
        const randomNum = Math.floor(Math.random() * 1000);
        const slug = network_name.trim().replace(/\s+/g, '-').toLowerCase() + '-' + randomNum;

        // حفظ صاحب الشبكة في قاعدة البيانات
        const newNetwork = await pool.query(
            `INSERT INTO networks (owner_name, email, password_hash, network_name, slug) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id, network_name, slug`,
            [owner_name, email, password_hash, network_name, slug]
        );

        const networkId = newNetwork.rows[0].id;

        // إنشاء 3 باقات افتراضية لهذه الشبكة الجديدة تلقائياً
        await pool.query(`INSERT INTO packages (network_id, name, price, mikrotik_profile) VALUES 
            ($1, 'ابو 100', 100, '1Hour'), 
            ($1, 'ابو 250', 250, '10Hours'),
            ($1, 'ابو 500', 500, '22Hours')`, [networkId]);

        res.json({ 
            success: true, 
            message: 'تم إنشاء حسابك ومتجرك بنجاح!',
            store_url: `https://metatron.com/store/${newNetwork.rows[0].slug}` // رابط متجره الخاص
        });

    } catch (err) {
        console.error('خطأ في التسجيل:', err);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ----------------------------------------------------
// 3. مسار جلب باقات المتجر بناءً على (رابط الشبكة - Slug)
// ----------------------------------------------------
app.get('/api/store-packages/:slug', async (req, res) => {
    const { slug } = req.params;

    try {
        // البحث عن الشبكة باستخدام الرابط (Slug)
        const networkResult = await pool.query('SELECT id, network_name FROM networks WHERE slug = $1', [slug]);
        
        if (networkResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'عفواً، هذه الشبكة غير موجودة في منصة ميتا ترون!' });
        }

        const networkId = networkResult.rows[0].id;
        const networkName = networkResult.rows[0].network_name;

        // جلب كروت هذه الشبكة فقط
        const query = `
            SELECT 
                p.id, 
                p.name, 
                p.price, 
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
            network_name: networkName,
            packages: result.rows
        });

    } catch (err) {
        console.error('خطأ في جلب المتجر:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر' });
    }
});

// (هنا مسارات الرفع والدفع بقيت كما هي وسنقوم بربطها لاحقاً بمعرف الشبكة الجديد)
app.post('/api/upload-cards', upload.single('file'), async (req, res) => { /* نفس الكود السابق */ });
app.post('/api/checkout', async (req, res) => { /* نفس الكود السابق */ });

// ----------------------------------------------------
// 4. مسار تسجيل الدخول (Login) لأصحاب الشبكات
// ----------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. البحث عن الحساب في قاعدة البيانات
        const result = await pool.query('SELECT * FROM networks WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'البريد الإلكتروني غير مسجل لدينا!' });
        }

        const network = result.rows[0];

        // 2. التحقق من كلمة المرور (مقارنة الكلمة المدخلة بالكلمة المشفرة)
        const validPassword = await bcrypt.compare(password, network.password_hash);
        if (!validPassword) {
            return res.status(400).json({ success: false, message: 'كلمة المرور خاطئة!' });
        }

        // 3. إنشاء تصريح الدخول (Token) مشفر
        const token = jwt.sign(
            { id: network.id, slug: network.slug }, 
            JWT_SECRET, 
            { expiresIn: '7d' } // التصريح صالح لمدة 7 أيام
        );

        res.json({
            success: true,
            message: 'تم تسجيل الدخول بنجاح!',
            token: token,
            network_data: {
                id: network.id,
                network_name: network.network_name,
                slug: network.slug
            }
        });

    } catch (err) {
        console.error('خطأ في تسجيل الدخول:', err);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 سيرفر ميتا ترون يعمل الآن على المنفذ ${PORT}`);
});