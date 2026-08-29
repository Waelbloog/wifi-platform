const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const multer = require('multer');
const xlsx = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// 🔐 وحدة المصادقة (Auth API) - تسجيل الدخول وإنشاء الحساب
// ============================================================================

app.post('/api/auth/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM networks WHERE phone = $1', [phone]);
        if (result.rows.length === 0) return res.status(400).json({ success: false, message: 'رقم الهاتف غير مسجل لدينا.' });

        const network = result.rows[0];
        const isMatch = await bcrypt.compare(password, network.password_hash);
        if (!isMatch) return res.status(400).json({ success: false, message: 'كلمة المرور غير صحيحة.' });

        if (network.status === 'SUSPENDED') return res.status(403).json({ success: false, message: 'حساب هذه الشبكة موقوف.' });

        const token = jwt.sign({ id: network.id, role: 'PROVIDER' }, 'METATRON_SECRET_KEY', { expiresIn: '7d' });

        res.json({
            success: true,
            token,
            network_data: { id: network.id, network_name: network.network_name, slug: network.slug }
        });
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, message: 'خطأ داخلي في السيرفر' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    const { owner_name, phone, password, network_name, governorate, district, neighborhood, latitude, longitude, packages } = req.body;
    try {
        const checkPhone = await pool.query('SELECT id FROM networks WHERE phone = $1', [phone]);
        if (checkPhone.rows.length > 0) return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل بشبكة أخرى مسبقاً.' });

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const slug = network_name.replace(/\s+/g, '-').toLowerCase() + '-' + Math.floor(1000 + Math.random() * 9000);

        const newNetwork = await pool.query(`
            INSERT INTO networks (owner_name, network_name, slug, phone, password_hash, governorate, district, neighborhood, latitude, longitude)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
        `, [owner_name, network_name, slug, phone, password_hash, governorate, district, neighborhood, latitude, longitude]);

        const networkId = newNetwork.rows[0].id;

        if (packages && packages.length > 0) {
            for (let pkg of packages) {
                await pool.query(`
                    INSERT INTO packages (network_id, name, price, time_limit, data_limit)
                    VALUES ($1, $2, $3, $4, $5)
                `, [networkId, pkg.name, pkg.price, pkg.usage, pkg.data]);
            }
        }
        res.json({ success: true, message: 'تم إنشاء الشبكة بنجاح!' });
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ success: false, message: 'فشل في حفظ البيانات.' });
    }
});

// ============================================================================
// 👑 وحدة الإدارة العليا (Super Admin API) 
// ============================================================================

app.get('/api/superadmin/stats', async (req, res) => {
    try {
        const networksCount = await pool.query('SELECT COUNT(id) FROM networks');
        const salesQuery = await pool.query(`
            SELECT COUNT(id) as total_transactions, COALESCE(SUM(amount), 0) as total_sales 
            FROM transactions WHERE status = 'completed'
        `);
        
        const total_networks = parseInt(networksCount.rows[0].count);
        const total_transactions = parseInt(salesQuery.rows[0].total_transactions);
        const total_sales = parseFloat(salesQuery.rows[0].total_sales);
        const platform_commission = total_sales * 0.05;

        res.json({ success: true, stats: { total_networks, total_transactions, total_sales, platform_commission } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء حساب الأرباح' });
    }
});

app.get('/', (req, res) => {
    res.send('🚀 سيرفر MetaTron يعمل بنجاح!');
});


// ============================================================================
// 📦 وحدة إدارة الكروت والخزنة (Inventory API)
// ============================================================================

// 1. جلب باقات الشبكة (لتعبئة القائمة المنسدلة في لوحة التحكم)
app.get('/api/store-packages/:slug', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, p.name, p.price 
            FROM packages p 
            JOIN networks n ON p.network_id = n.id 
            WHERE n.slug = $1
        `, [req.params.slug]);
        res.json({ success: true, packages: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 2. إضافة كرت للخزنة (يدوياً)
app.post('/api/cards/manual', async (req, res) => {
    const { network_id, package_id, username, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO cards (network_id, package_id, username, password, status) VALUES ($1, $2, $3, $4, $5)',
            [network_id, package_id, username.toString().trim(), password ? password.toString().trim() : '', 'available']
        );
        res.json({ success: true, message: 'تم إضافة الكرت بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل إضافة الكرت' });
    }
});

// 3. رفع كروت للخزنة دفعة واحدة (عبر ملف Excel)
app.post('/api/upload-cards', upload.single('file'), async (req, res) => {
    const { network_id, package_id } = req.body;
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'لم يتم رفع أي ملف' });
        
        // قراءة ملف الإكسل من الذاكرة
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        
        let addedCount = 0;
        for (let row of data) {
            const username = row[0]; // نفترض أن العمود الأول هو اليوزر
            const password = row[1] || ''; // العمود الثاني الباسورد (إن وجد)
            
            if (username) {
                await pool.query(
                    'INSERT INTO cards (network_id, package_id, username, password, status) VALUES ($1, $2, $3, $4, $5)',
                    [network_id, package_id, username.toString().trim(), password.toString().trim(), 'available']
                );
                addedCount++;
            }
        }
        res.json({ success: true, message: `تم رفع ${addedCount} كرت بنجاح!` });
    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).json({ success: false, message: 'فشل في قراءة الملف، تأكد من صيغته' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ سيرفر MetaTron يعمل على المنفذ: ${PORT}`);
});
