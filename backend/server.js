// ============================================================================
// 👑 وحدة الإدارة العليا (Super Admin API) - [الربط الحقيقي بقاعدة البيانات]
// ============================================================================

// 1. جلب إحصائيات لوحة الإدارة العليا (حساب الأرباح والمبيعات الحقيقية)
app.get('/api/superadmin/stats', async (req, res) => {
    try {
        // أ. حساب إجمالي الشبكات المسجلة في النظام
        const networksCount = await pool.query('SELECT COUNT(id) FROM networks');
        
        // ب. جمع كل المبيعات الناجحة من جميع المتاجر
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
        
        // ج. حساب عمولة المنصة (5% من إجمالي المبيعات)
        const platform_commission = total_sales * 0.05;

        res.json({
            success: true,
            stats: {
                total_networks,
                total_transactions,
                total_sales,
                platform_commission
            }
        });
    } catch (err) {
        console.error("Super Admin Stats Error:", err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء حساب الأرباح' });
    }
});

// 2. جلب قائمة الشبكات الحقيقية (لجدول إدارة الشبكات)
app.get('/api/superadmin/networks', async (req, res) => {
    try {
        // استعلام ذكي (JOIN) يجلب الشبكة + إجمالي مبيعاتها + حالتها
        const networksData = await pool.query(`
            SELECT 
                n.id, 
                n.network_name as name, 
                n.owner_name as owner, 
                n.status, 
                n.created_at,
                COALESCE(SUM(t.amount), 0) as sales
            FROM networks n
            LEFT JOIN transactions t ON n.id = t.network_id AND t.status = 'completed'
            GROUP BY n.id, n.network_name, n.owner_name, n.status, n.created_at
            ORDER BY n.created_at DESC
        `);

        res.json({ success: true, networks: networksData.rows });
    } catch (err) {
        console.error("Super Admin Networks Error:", err);
        res.status(500).json({ success: false, message: 'خطأ في جلب بيانات الشبكات' });
    }
});

// 3. التحكم بصلاحيات الشبكة (حظر / إعادة تفعيل)
app.put('/api/superadmin/networks/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // يستقبل 'ACTIVE' أو 'SUSPENDED'
    
    try {
        await pool.query('UPDATE networks SET status = $1 WHERE id = $2', [status, id]);
        res.json({ success: true, message: `تم تغيير حالة الشبكة إلى ${status} بنجاح` });
    } catch (err) {
        console.error("Update Status Error:", err);
        res.status(500).json({ success: false, message: 'فشل في تحديث حالة الشبكة' });
    }
});