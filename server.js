const express = require('express');
const cors = require('cors');
const pool = require('./db'); // استدعاء ملف الاتصال بقاعدة البيانات

const app = express();

// إعدادات الحماية واستقبال البيانات
app.use(cors());
app.use(express.json());

// ============================================================================
// 👑 وحدة الإدارة العليا (Super Admin API) 
// ============================================================================

// 1. جلب إحصائيات لوحة الإدارة العليا
app.get('/api/superadmin/stats', async (req, res) => {
    try {
        const networksCount = await pool.query('SELECT COUNT(id) FROM networks');
        const salesQuery = await pool.query(`
            SELECT 
                COUNT(id) as total_transactions, 
                COALESCE(SUM(amount), 0) as total_sales 
            FROM transactions 
            WHERE status = 'completed'
        `);
        
        const total_networks = parseInt(networksCount.rows[0].count);
        const total_transactions = parseInt(salesQuery.rows[0].total_transactions);
        const total_sales = parseFloat(salesQuery.rows[0].total_sales);
        const platform_commission = total_sales * 0.05;

        res.json({ success: true, stats: { total_networks, total_transactions, total_sales, platform_commission } });
    } catch (err) {
        console.error("Stats Error:", err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء حساب الأرباح' });
    }
});

// 2. جلب قائمة الشبكات
app.get('/api/superadmin/networks', async (req, res) => {
    try {
        const networksData = await pool.query(`
            SELECT n.id, n.network_name as name, n.owner_name as owner, n.status, n.created_at, COALESCE(SUM(t.amount), 0) as sales
            FROM networks n
            LEFT JOIN transactions t ON n.id = t.network_id AND t.status = 'completed'
            GROUP BY n.id, n.network_name, n.owner_name, n.status, n.created_at
            ORDER BY n.created_at DESC
        `);
        res.json({ success: true, networks: networksData.rows });
    } catch (err) {
        console.error("Networks Error:", err);
        res.status(500).json({ success: false, message: 'خطأ في جلب بيانات الشبكات' });
    }
});

// مسار اختباري للتأكد من عمل السيرفر
app.get('/', (req, res) => {
    res.send('🚀 سيرفر MetaTron يعمل بنجاح!');
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ سيرفر MetaTron يعمل على المنفذ: ${PORT}`);
});