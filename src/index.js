// ============================================================
// index.js (Main Server)
// ============================================================
// หน้าที่: Web Server ที่รับ Webhook จาก Payment Gateway
//         แล้วโยน order เข้า Queue
//
// Flow: Payment สำเร็จ → Gateway เรียก POST /webhook/payment
//       → Server รับ → ตรวจสอบ → addTopupJob() → Bot ทำงาน
// ============================================================

import express from 'express';
import { addTopupJob, getQueueStats } from './queue/orderQueue.js';
import 'dotenv/config';

const app = express();
app.use(express.json());

// ============================================================
// POST /webhook/payment
// Payment Gateway จะเรียก endpoint นี้หลังลูกค้าจ่ายเงินสำเร็จ
// ============================================================
app.post('/webhook/payment', async (req, res) => {
  try {
    const payload = req.body;
    
    // ── ตรวจสอบ Webhook Secret ─────────────────────────────
    // ป้องกันคนอื่นส่ง fake request มาหลอก
    const secret = req.headers['x-webhook-secret'];
    if (secret !== process.env.WEBHOOK_SECRET) {
      console.warn('⚠️  Invalid webhook secret!');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── ตรวจสอบว่า payment สำเร็จจริง ────────────────────
    if (payload.status !== 'SUCCESS' && payload.status !== 'PAID') {
      console.log(`ℹ️  Payment status: ${payload.status} - ไม่ต้อง process`);
      return res.json({ received: true, action: 'ignored' });
    }

    // ── แปลง Payload ให้เป็น Order Data ───────────────────
    // ✏️  ปรับ field names ให้ตรงกับ payload จาก payment gateway จริงๆ
    const orderData = {
      orderId: payload.order_id || payload.reference_id,
      userId: payload.player_uid || payload.metadata?.player_uid,
      packageId: payload.product_id || payload.metadata?.package_id,
      customerEmail: payload.customer_email,
      amount: payload.amount,
      currency: payload.currency || 'THB',
      paidAt: new Date().toISOString(),
    };

    // ตรวจว่าข้อมูลครบ
    if (!orderData.orderId || !orderData.userId || !orderData.packageId) {
      console.error('❌ ข้อมูล order ไม่ครบ:', orderData);
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`\n💳 Payment สำเร็จ! กำลังเพิ่มเข้า Queue...`);
    console.log(`   Order: ${orderData.orderId} | UID: ${orderData.userId}`);

    // ── โยนเข้า Queue ──────────────────────────────────────
    const job = await addTopupJob(orderData);

    // ตอบ Gateway ทันที (ไม่รอให้ bot เสร็จ)
    res.json({
      received: true,
      jobId: job.id,
      orderId: orderData.orderId,
      message: 'Order queued successfully',
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /orders/manual
// สำหรับเพิ่ม order เข้าคิว manual (test หรือ retry)
// ============================================================
app.post('/orders/manual', async (req, res) => {
  try {
    const orderData = req.body;
    
    // ตรวจ field ที่จำเป็น
    if (!orderData.orderId || !orderData.userId || !orderData.packageId) {
      return res.status(400).json({
        error: 'ต้องมี: orderId, userId, packageId'
      });
    }

    const job = await addTopupJob(orderData);
    
    res.json({
      success: true,
      jobId: job.id,
      message: `Order ${orderData.orderId} เพิ่มเข้าคิวแล้ว`,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /status
// Dashboard สถานะระบบ
// ============================================================
app.get('/status', async (req, res) => {
  const stats = await getQueueStats();
  
  res.json({
    status: 'running',
    queue: stats,
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// เริ่ม Server
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 G23 Bot Server เริ่มทำงานที่ port ${PORT}`);
  console.log(`   POST http://localhost:${PORT}/webhook/payment  ← รับ payment webhook`);
  console.log(`   POST http://localhost:${PORT}/orders/manual    ← เพิ่ม order manual`);
  console.log(`   GET  http://localhost:${PORT}/status           ← ดูสถานะระบบ\n`);
});
