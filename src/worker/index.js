// ============================================================
// worker/index.js
// ============================================================
// หน้าที่: "WORKER" คือตัวที่รับ Job จากคิว แล้วสั่ง Bot ทำงาน
//
// Flow:
// Queue มี Job → Worker หยิบ Job → สั่ง Bot → อัปเดตสถานะ
//
// เปรียบเหมือน: Queue = ตะกร้า, Worker = พนักงาน, Bot = มือ
// ============================================================

import { Worker, QueueEvents } from 'bullmq';
import { redisConnection } from '../queue/redisClient.js';
import { PartnerBot } from './partnerBot.js';
import { sendFailureAlert } from './notifier.js';
import 'dotenv/config';

console.log('🤖 G23 Automation Worker เริ่มทำงาน...');
console.log(`⚙️  Max concurrent jobs: ${process.env.MAX_CONCURRENT_JOBS || 2}`);

// ============================================================
// สร้าง Worker
// Worker จะ "ฟัง" คิวชื่อ 'topup-orders' ตลอดเวลา
// ============================================================
const worker = new Worker(
  'topup-orders', // ชื่อคิว (ต้องตรงกับที่ orderQueue.js ใช้)
  
  // ── Processor Function ────────────────────────────────────
  // ฟังก์ชันนี้จะถูกเรียกทุกครั้งที่มี Job ใหม่
  async (job) => {
    const orderData = job.data; // ข้อมูล order ที่ส่งมาตอน addTopupJob()
    
    console.log('\n' + '='.repeat(50));
    console.log(`📋 รับ Job: ${job.id}`);
    console.log(`   Order ID : ${orderData.orderId}`);
    console.log(`   UID      : ${orderData.userId}`);
    console.log(`   Package  : ${orderData.packageId}`);
    console.log(`   Attempt  : ${job.attemptsMade + 1} / ${job.opts.attempts}`);
    console.log('='.repeat(50));

    // อัปเดต progress ให้รู้ว่า job กำลังทำงาน (0-100)
    await job.updateProgress(10);

    // สร้าง Bot instance ใหม่ทุก job
    // (แต่ละ order จะมี bot ของตัวเอง)
    const bot = new PartnerBot();

    try {
      await job.updateProgress(20); // 20% = กำลังเปิด browser

      // ── สั่ง Bot ทำงาน ─────────────────────────────────
      const result = await bot.run(orderData);
      
      await job.updateProgress(90); // 90% = เสร็จแล้ว กำลัง wrap up

      // บันทึกผลลัพธ์ใน job (ดูได้ใน dashboard ภายหลัง)
      await job.updateData({
        ...orderData,
        result,
      });

      await job.updateProgress(100);
      
      console.log(`\n✅ Job ${job.id} สำเร็จ!`);
      
      // TODO: อัปเดต order status ใน database ของ G23
      // await updateOrderStatus(orderData.orderId, 'completed', result);
      
      // TODO: ส่ง email/Line แจ้งลูกค้า
      // await notifyCustomer(orderData.customerEmail, 'success');

      return result; // BullMQ จะบันทึก return value นี้

    } catch (error) {
      console.error(`\n❌ Job ${job.id} ล้มเหลว: ${error.message}`);
      
      // ถ่าย screenshot ตอน error ด้วย (ถ้า browser ยังเปิดอยู่)
      try {
        await bot.screenshot(orderData.orderId, 'error');
      } catch (_) {}
      
      // ปิด browser กรณี error
      await bot.close().catch(() => {});
      
      // โยน error ออกไป → BullMQ จะ retry อัตโนมัติ
      throw error;
    }
  },

  // ── Worker Options ────────────────────────────────────────
  {
    connection: redisConnection,
    
    // จำนวน job ที่ทำพร้อมกันได้
    // ถ้า partner มีการ rate limit แนะนำใช้ 1-2
    concurrency: parseInt(process.env.MAX_CONCURRENT_JOBS) || 2,
    
    // รอ job ใหม่นาน 5 วิ ก่อน poll ใหม่
    stalledInterval: 30000,
  }
);

// ============================================================
// Event Listeners - ติดตามสถานะ Job
// ============================================================

// เมื่อ Job สำเร็จ
worker.on('completed', (job, result) => {
  console.log(`\n🎉 Order ${job.data.orderId} เสร็จสมบูรณ์`);
});

// เมื่อ Job ล้มเหลว (ครบ retry แล้ว)
worker.on('failed', async (job, error) => {
  console.error(`\n🚨 Order ${job.data.orderId} ล้มเหลวถาวร: ${error.message}`);
  
  // แจ้งทีมงานทันที!
  await sendFailureAlert({
    orderId: job.data.orderId,
    userId: job.data.userId,
    error: error.message,
    attempts: job.attemptsMade,
  }).catch(e => console.error('แจ้งเตือนล้มเหลว:', e));
});

// เมื่อ Worker เจอ error (ไม่ใช่ job error)
worker.on('error', (error) => {
  console.error('Worker error:', error);
});

// ============================================================
// Graceful Shutdown
// ปิด worker อย่างสุภาพ เมื่อกด Ctrl+C
// ============================================================
process.on('SIGTERM', async () => {
  console.log('\n⏹️  กำลังปิด Worker...');
  await worker.close();
  console.log('✅ Worker ปิดแล้ว');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⏹️  กำลังปิด Worker... (Ctrl+C)');
  await worker.close();
  process.exit(0);
});

console.log('👂 Worker กำลังฟัง Queue "topup-orders"...\n');
