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
const pool = require('./db');
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
        const checkEmail = await pool.query('SELECT * FROM networks WHERE email = $1', [email]);
        if (checkEmail.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'هذا البريد الإلكتروني مسجل مسبقاً!' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const randomNum = Math.floor(Math.random() * 1000);
        const slug = network_name.trim().replace(/\s+/g, '-').toLowerCase() + '-' + randomNum;

        const newNetwork = await pool.query(
            `INSERT INTO networks (owner_name, email, password_hash, network_name, slug) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id, network_name, slug`,
            [owner_name, email, password_hash, network_name, slug]
        );

        const networkId = newNetwork.rows[0].id;

        await pool.query(`INSERT INTO packages (network_id, name, price, mikrotik_profile) VALUES 
            ($1, 'ابو 100', 100, '1Hour'), 
            ($1, 'ابو 250', 250, '10Hours'),
            ($1, 'ابو 500', 500, '22Hours')`, [networkId]);

        res.json({ 
            success: true, 
            message: 'تم إنشاء حسابك ومتجرك بنجاح!',
            store_url: `https://metatron.com/store/${newNetwork.rows[0].slug}`
        });

    } catch (err) {
        console.error('خطأ في التسجيل:', err);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// 🚀 مسار سري لبناء قاعدة البيانات (قم بحذفه بعد الانتهاء من التثبيت)
app.get('/api/setup-database', async (req, res) => {
    const setupSQL = `
        CREATE TABLE IF NOT EXISTS mikrotik_routers (
            id SERIAL PRIMARY KEY,
            network_id INTEGER,
            ip_address VARCHAR(50) NOT NULL,
            api_port INTEGER DEFAULT 8728,
            api_username VARCHAR(50) NOT NULL,
            api_password VARCHAR(255) NOT NULL,
            is_active BOOLEAN DEFAULT true
        );

        CREATE TABLE IF NOT EXISTS system_users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(20) CHECK (role IN ('SUPER_ADMIN', 'SUPPORT_AGENT')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS withdrawals (
            id SERIAL PRIMARY KEY,
            network_id INTEGER,
            amount DECIMAL(10, 2) NOT NULL,
            bank_account_info TEXT NOT NULL,
            status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
            processed_by INTEGER REFERENCES system_users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER,
            network_id INTEGER,
            subject VARCHAR(200) NOT NULL,
            description TEXT NOT NULL,
            status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
            assigned_to INTEGER REFERENCES system_users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            user_type VARCHAR(20) NOT NULL,
            user_id INTEGER NOT NULL,
            action VARCHAR(100) NOT NULL,
            ip_address VARCHAR(50),
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE customers ADD COLUMN IF NOT EXISTS reward_points INTEGER DEFAULT 0;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS referred_by INTEGER;

        INSERT INTO system_users (name, email, password_hash, role) 
        VALUES ('مدير النظام', 'admin@metatron.com', 'admin123', 'SUPER_ADMIN')
        ON CONFLICT (email) DO NOTHING;
    `;

    try {
        // ملاحظة: استبدل 'pool' باسم متغير قاعدة البيانات لديك إذا كان مختلفاً (مثل db أو client)
        await pool.query(setupSQL);
        res.send('✅ مبروك! تم بناء جداول البنية التحتية لإمبراطورية ميتا ترون بنجاح.');
    } catch (error) {
        console.error(error);
        res.status(500).send('❌ حدث خطأ أثناء بناء الجداول: ' + error.message);
    }
});

// ----------------------------------------------------
// 3. مسار جلب باقات المتجر بناءً على (رابط الشبكة - Slug)
// ----------------------------------------------------
app.get('/api/store-packages/:slug', async (req, res) => {
    const { slug } = req.params;

    try {
        const networkResult = await pool.query('SELECT id, network_name FROM networks WHERE slug = $1', [slug]);
        
        if (networkResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'عفواً، هذه الشبكة غير موجودة في منصة ميتا ترون!' });
        }

        const networkId = networkResult.rows[0].id;
        const networkName = networkResult.rows[0].network_name;

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
            network_id: networkId,
            packages: result.rows
        });

    } catch (err) {
        console.error('خطأ في جلب المتجر:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر' });
    }
});

// ----------------------------------------------------
// 4. مسار (API) لاستقبال ملف الإكسل من لوحة التحكم (مضاد للأخطاء)
// ----------------------------------------------------
app.post('/api/upload-cards', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'الرجاء إرفاق ملف الكروت' });
        }

        const network_id = parseInt(req.body.network_id);
        const package_id = parseInt(req.body.package_id);

        if (!network_id || !package_id) {
            return res.status(400).json({ success: false, message: 'بيانات الشبكة أو الباقة مفقودة!' });
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; 
        const sheet = workbook.Sheets[sheetName];
        
        const rawCards = xlsx.utils.sheet_to_json(sheet);
        let insertedCount = 0;

        for (let row of rawCards) {
            const normalizedRow = {};
            for (let key in row) {
                normalizedRow[key.toLowerCase().trim().replace(/[^a-z0-9_]/gi, '')] = row[key];
            }

            const username = normalizedRow.username || normalizedRow.pin || normalizedRow.user;
            const password = normalizedRow.password || normalizedRow.pass || '';

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
            message: `تمت المعالجة بنجاح! تم حفظ ${insertedCount} كرت في الخزنة.` 
        });

    } catch (err) {
        console.error('خطأ قاتل في معالجة الملف:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ----------------------------------------------------
// 5. مسار تسجيل الدخول (Login) لأصحاب الشبكات
// ----------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM networks WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'البريد الإلكتروني غير مسجل لدينا!' });
        }

        const network = result.rows[0];
        const validPassword = await bcrypt.compare(password, network.password_hash);
        if (!validPassword) {
            return res.status(400).json({ success: false, message: 'كلمة المرور خاطئة!' });
        }

        const token = jwt.sign(
            { id: network.id, slug: network.slug }, 
            JWT_SECRET, 
            { expiresIn: '7d' } 
        );

        res.json({
            success: true,
            message: 'تم تسجيل الدخول بنجاح!',
            token: token,
            network_data: { id: network.id, network_name: network.network_name, slug: network.slug }
        });

    } catch (err) {
        console.error('خطأ في تسجيل الدخول:', err);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ----------------------------------------------------
// 6. مسار الدفع وصرف الكروت للعميل (مطور ليدعم المحفظة)
// ----------------------------------------------------
app.post('/api/checkout', async (req, res) => {
    const { network_id, package_id, phone, wallet, amount } = req.body;
    const authHeader = req.headers.authorization;
    let customerId = null;

    try {
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            customerId = decoded.id;
        }

        const cardResult = await pool.query(
            `SELECT id, username, password FROM cards WHERE network_id = $1 AND package_id = $2 AND status = 'available' LIMIT 1`, 
            [network_id, package_id]
        );

        if (cardResult.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'عفواً، نفدت الكروت لهذه الباقة!' });
        }
        const card = cardResult.rows[0];

        // الخصم المباشر من محفظة ميتا ترون
        if (wallet === 'metatron_wallet') {
            if (!customerId) return res.status(401).json({ success: false, message: 'يجب تسجيل الدخول لاستخدام محفظة المنصة' });
            
            const customerResult = await pool.query('SELECT wallet_balance FROM customers WHERE id = $1', [customerId]);
            const currentBalance = parseFloat(customerResult.rows[0].wallet_balance);

            if (currentBalance < amount) {
                return res.status(400).json({ success: false, message: 'رصيد محفظتك غير كافٍ، يرجى الشحن أولاً' });
            }

            await pool.query('UPDATE customers SET wallet_balance = wallet_balance - $1 WHERE id = $2', [amount, customerId]);
        } 

        await pool.query(`UPDATE cards SET status = 'sold', sold_at = CURRENT_TIMESTAMP WHERE id = $1`, [card.id]);

        await pool.query(
            `INSERT INTO transactions (network_id, card_id, customer_phone, amount, wallet_provider, status) VALUES ($1, $2, $3, $4, $5, 'completed')`,
            [network_id, card.id, phone, amount, wallet]
        );

        res.json({ success: true, message: 'تم الدفع بنجاح!', card: { username: card.username, password: card.password } });
    } catch (err) {
        console.error('خطأ في عملية الدفع:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ في النظام أثناء معالجة الدفع' });
    }
});

// ----------------------------------------------------
// 7. نظام حسابات العملاء (المشترين) وجدولهم
// ----------------------------------------------------
app.get('/setup-customers', async (req, res) => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                wallet_balance DECIMAL(10, 2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        res.send('✅ تم إنشاء جدول العملاء (Customers) بنجاح!');
    } catch (err) {
        res.status(500).send('❌ خطأ: ' + err.message);
    }
});

app.post('/api/customer/register', async (req, res) => {
    const { name, phone, password } = req.body;
    try {
        const checkPhone = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
        if (checkPhone.rows.length > 0) return res.status(400).json({ success: false, message: 'هذا الرقم مسجل لدينا بالفعل!' });

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const newCustomer = await pool.query(
            `INSERT INTO customers (name, phone, password_hash) VALUES ($1, $2, $3) RETURNING id, name, phone`,
            [name, phone, password_hash]
        );

        const token = jwt.sign({ id: newCustomer.rows[0].id, role: 'customer' }, JWT_SECRET, { expiresIn: '30d' });

        res.json({ success: true, message: 'تم إنشاء حسابك بنجاح!', token, customer: newCustomer.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

app.post('/api/customer/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
        if (result.rows.length === 0) return res.status(400).json({ success: false, message: 'رقم الجوال غير صحيح أو غير مسجل!' });

        const customer = result.rows[0];
        const validPassword = await bcrypt.compare(password, customer.password_hash);
        if (!validPassword) return res.status(400).json({ success: false, message: 'كلمة المرور خاطئة!' });

        const token = jwt.sign({ id: customer.id, role: 'customer' }, JWT_SECRET, { expiresIn: '30d' });

        res.json({ success: true, message: 'تم تسجيل الدخول!', token, customer: { id: customer.id, name: customer.name, phone: customer.phone } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ----------------------------------------------------
// 8. جلب قائمة الشبكات للعملاء (Customer Portal)
// ----------------------------------------------------
app.get('/api/networks', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, network_name, slug FROM networks ORDER BY created_at DESC');
        res.json({ success: true, networks: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر' });
    }
});

// ----------------------------------------------------
// 9. جلب المشتريات السابقة للعميل
// ----------------------------------------------------
app.get('/api/customer/purchases', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'غير مصرح لك بالدخول' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const query = `
            SELECT t.amount, t.created_at, c.username, c.password, p.name as package_name, n.network_name
            FROM transactions t
            JOIN cards c ON t.card_id = c.id
            JOIN packages p ON c.package_id = p.id
            JOIN networks n ON t.network_id = n.id
            WHERE t.customer_phone = (SELECT phone FROM customers WHERE id = $1)
            ORDER BY t.created_at DESC;
        `;
        const result = await pool.query(query, [decoded.id]);
        res.json({ success: true, purchases: result.rows });
    } catch (err) {
        res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة' });
    }
});

// ----------------------------------------------------
// 10. المحفظة الرقمية للعميل (جلب الرصيد والشحن)
// ----------------------------------------------------
app.get('/api/customer/wallet', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'غير مصرح' });
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query('SELECT wallet_balance FROM customers WHERE id = $1', [decoded.id]);
        res.json({ success: true, balance: parseFloat(result.rows[0].wallet_balance) });
    } catch (err) {
        res.status(401).json({ success: false, message: 'جلسة غير صالحة' });
    }
});

app.post('/api/customer/wallet/topup', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'غير مصرح' });
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const { amount, payment_method } = req.body;
        
        await pool.query('UPDATE customers SET wallet_balance = wallet_balance + $1 WHERE id = $2', [amount, decoded.id]);
        const newBalance = await pool.query('SELECT wallet_balance FROM customers WHERE id = $1', [decoded.id]);
        
        res.json({ success: true, message: 'تم شحن محفظتك بنجاح!', new_balance: parseFloat(newBalance.rows[0].wallet_balance) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ----------------------------------------------------
// 11. مسار الإدارة العليا (Super Admin Dashboard)
// ----------------------------------------------------
app.get('/api/superadmin/stats', async (req, res) => {
    try {
        // 1. إجمالي عدد الشبكات المسجلة في المنصة
        const networksCount = await pool.query('SELECT COUNT(*) FROM networks');
        
        // 2. إجمالي المبيعات الناجحة في كل المنصة وعدد الكروت
        const salesResult = await pool.query("SELECT COALESCE(SUM(amount), 0) as total_sales, COUNT(*) as total_transactions FROM transactions WHERE status = 'completed'");
        
        // 3. آخر 5 شبكات انضمت للمنصة
        const recentNetworks = await pool.query('SELECT network_name, owner_name, created_at FROM networks ORDER BY created_at DESC LIMIT 5');
        
        const totalSales = parseFloat(salesResult.rows[0].total_sales);
        const totalTransactions = parseInt(salesResult.rows[0].total_transactions);
        
        // 💡 حساب أرباح منصتك! (مثال: عمولة 5% من كل مبيعات الشبكات)
        const platformCommission = totalSales * 0.05;

        res.json({
            success: true,
            stats: {
                total_networks: parseInt(networksCount.rows[0].count),
                total_sales: totalSales,
                total_transactions: totalTransactions,
                platform_commission: platformCommission
            },
            recent_networks: recentNetworks.rows
        });
    } catch (err) {
        console.error('Super Admin Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب بيانات الإدارة العليا' });
    }
});


// ----------------------------------------------------
// 12. مسار إحصائيات لوحة صاحب الشبكة (Network Admin Stats)
// ----------------------------------------------------
app.get('/api/network/stats', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'غير مصرح' });

    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const networkId = decoded.id;

        // 1. مبيعات اليوم
        const todayStats = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as today_revenue, COUNT(id) as today_sold 
            FROM transactions 
            WHERE network_id = $1 AND status = 'completed' AND DATE(created_at) = CURRENT_DATE
        `, [networkId]);

        // 2. إجمالي الأرباح
        const totalStats = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total_revenue 
            FROM transactions 
            WHERE network_id = $1 AND status = 'completed'
        `, [networkId]);

        // 3. الباقات التي أوشكت على النفاد (أقل من 20 كرت)
        const lowStock = await pool.query(`
            SELECT p.name, COUNT(c.id) as available_cards
            FROM packages p
            LEFT JOIN cards c ON p.id = c.package_id AND c.status = 'available'
            WHERE p.network_id = $1
            GROUP BY p.id, p.name
            HAVING COUNT(c.id) < 20
        `, [networkId]);

        // 4. بيانات الرسم البياني (مبيعات آخر 7 أيام)
        const chartData = await pool.query(`
            SELECT TO_CHAR(created_at, 'Day') as day_name, SUM(amount) as daily_total
            FROM transactions
            WHERE network_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY TO_CHAR(created_at, 'Day'), DATE(created_at)
            ORDER BY DATE(created_at) ASC
        `, [networkId]);

        res.json({
            success: true,
            today_revenue: parseFloat(todayStats.rows[0].today_revenue),
            today_sold: parseInt(todayStats.rows[0].today_sold),
            total_revenue: parseFloat(totalStats.rows[0].total_revenue),
            low_stock: lowStock.rows,
            chart_data: chartData.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 سيرفر ميتا ترون يعمل الآن على المنفذ ${PORT}`);
});