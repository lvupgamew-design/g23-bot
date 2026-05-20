// ============================================================
// queue/orderQueue.js
// ============================================================
// หน้าที่: สร้างและจัดการ "คิว" สำหรับ order ที่รอดำเนินการ
//
// คิดว่าคิวนี้เหมือน "ตะกร้า" ที่รับ order เข้ามาเรื่อยๆ
// แล้ว Worker (Bot) จะค่อยๆ หยิบออกไปทำทีละอัน
// ============================================================

import { Queue } from 'bullmq';
import { redisConnection } from './redisClient.js';

// สร้าง Queue ชื่อ 'topup-orders'
// Queue คือ "ลำดับคิว" ที่เก็บ job รอดำเนินการ
export const orderQueue = new Queue('topup-orders', {
  connection: redisConnection,
  
  defaultJobOptions: {
    // ถ้า job ล้มเหลว ให้ลองใหม่สูงสุด 3 ครั้ง
    attempts: 3,
    
    backoff: {
      type: 'exponential',  // รอนานขึ้นเรื่อยๆ ระหว่าง retry
      delay: 5000,          // เริ่มที่ 5 วิ → 10 วิ → 20 วิ
    },
    
    // เก็บประวัติ job ที่สำเร็จไว้ 100 รายการ (เพื่อดู log)
    removeOnComplete: { count: 100 },
    
    // เก็บประวัติ job ที่ล้มเหลวไว้ 50 รายการ
    removeOnFail: { count: 50 },
  },
});

// ============================================================
// ฟังก์ชัน addTopupJob
// ใช้เรียกตอนที่มี order ใหม่เข้ามา (หลัง payment สำเร็จ)
// ============================================================
export async function addTopupJob(orderData) {
  // orderData คือข้อมูล order เช่น:
  // {
  //   orderId: 'ORD-001',
  //   userId: 'UID-123456',     ← UID ของผู้เล่น
  //   packageId: 'diamond-100', ← package ที่ซื้อ
  //   customerEmail: 'player@email.com',
  //   amount: 99,
  // }

  const job = await orderQueue.add(
    'process-topup',   // ชื่อ job type
    orderData,          // ข้อมูลที่ส่งให้ Worker
    {
      // ตั้ง jobId ให้ตรงกับ orderId
      // ป้องกัน order เดิม ถูก process ซ้ำ
      jobId: `order-${orderData.orderId}`,
    }
  );

  console.log(`✅ เพิ่ม Order ${orderData.orderId} เข้าคิวแล้ว (Job ID: ${job.id})`);
  return job;
}

// ============================================================
// ฟังก์ชัน getQueueStats
// ดูสถานะคิวปัจจุบัน
// ============================================================
export async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    orderQueue.getWaitingCount(),   // รอดำเนินการ
    orderQueue.getActiveCount(),    // กำลังทำอยู่
    orderQueue.getCompletedCount(), // สำเร็จแล้ว
    orderQueue.getFailedCount(),    // ล้มเหลว
  ]);

  return { waiting, active, completed, failed };
}
