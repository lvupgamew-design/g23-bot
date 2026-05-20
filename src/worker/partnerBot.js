// ============================================================
// worker/partnerBot.js
// ============================================================
// หน้าที่: BOT ที่เปิด Browser แล้วทำงานแทนคนจริง
//         Login → กรอก UID → เลือก Package → Submit → Capture
//
// ⚠️  สำคัญ: แก้ไข selector (.username, #submit ฯลฯ)
//            ให้ตรงกับ HTML ของเว็บ partner จริงๆ
// ============================================================

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

const SCREENSHOT_DIR = './screenshots';

// สร้างโฟลเดอร์ screenshots ถ้ายังไม่มี
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ============================================================
// CLASS: PartnerBot
// ใช้งาน: const bot = new PartnerBot(); await bot.processOrder(data);
// ============================================================
export class PartnerBot {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.sessionFile = './partner-session.json'; // เก็บ cookie ไว้ใช้ซ้ำ
  }

  // ----------------------------------------------------------
  // STEP 1: เปิด Browser
  // ----------------------------------------------------------
  async launch() {
    console.log('🌐 กำลังเปิด Browser...');
    
    this.browser = await chromium.launch({
      // true = ไม่แสดงหน้าต่าง (production)
      // false = แสดงหน้าต่าง (ใช้ตอน debug ดูว่า bot ทำอะไร)
      headless: process.env.BOT_HEADLESS !== 'false',
      
      // slowMo: หน่วงทุก action X milliseconds
      // ทำให้ bot ดู "เป็นคน" มากขึ้น ป้องกัน rate limit
      slowMo: parseInt(process.env.BOT_SLOW_MO) || 100,
      
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // ซ่อนว่าเป็น bot
      ],
    });

    // โหลด session cookie ถ้ามี (ไม่ต้อง login ใหม่ทุกครั้ง)
    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 720 },
    };

    if (fs.existsSync(this.sessionFile)) {
      contextOptions.storageState = this.sessionFile;
      console.log('🍪 โหลด Session cookie เดิม (ไม่ต้อง login ใหม่)');
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
    
    // ซ่อน property ที่บอกว่าเป็น bot
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }

  // ----------------------------------------------------------
  // STEP 2: Login Partner Website
  // ----------------------------------------------------------
  async login() {
    console.log('🔐 กำลัง Login...');
    
    await this.page.goto(process.env.PARTNER_URL, {
      waitUntil: 'networkidle', // รอให้หน้าโหลดเสร็จสมบูรณ์
      timeout: parseInt(process.env.BOT_TIMEOUT) || 30000,
    });

    // ✏️  แก้ selector ให้ตรงกับเว็บ partner จริงๆ
    // วิธีหา selector: คลิกขวาที่ช่อง input → Inspect → copy selector
    
    // ตรวจว่า login แล้วหรือยัง (ถ้ามี session cookie อาจ skip ได้)
    const isLoggedIn = await this.page.$('.user-profile, .logout-btn, #dashboard')
      .then(el => !!el)
      .catch(() => false);

    if (isLoggedIn) {
      console.log('✅ ใช้ Session เดิม ไม่ต้อง Login ใหม่');
      return;
    }

    // กรอก Username
    await this.page.fill('#username', process.env.PARTNER_USERNAME);
    // รอนิดนึงเหมือนคนพิมพ์จริง
    await this.page.waitForTimeout(500 + Math.random() * 500);
    
    // กรอก Password
    await this.page.fill('#password', process.env.PARTNER_PASSWORD);
    await this.page.waitForTimeout(300 + Math.random() * 300);
    
    // กด Login
    await this.page.click('#login-btn');
    
    // รอให้ redirect ไปหน้าหลัก
    await this.page.waitForNavigation({ waitUntil: 'networkidle' });
    
    // บันทึก session cookie ไว้ใช้ครั้งต่อไป
    await this.context.storageState({ path: this.sessionFile });
    console.log('✅ Login สำเร็จ และบันทึก Session แล้ว');
  }

  // ----------------------------------------------------------
  // STEP 3: กรอกข้อมูล Order และ Submit
  // ----------------------------------------------------------
  async processTopup(orderData) {
    const { orderId, userId, packageId, customerEmail } = orderData;
    
    console.log(`📦 กำลังเติม Order ${orderId} | UID: ${userId} | Package: ${packageId}`);

    // ไปหน้า topup (บางเว็บอาจต้องคลิก menu)
    await this.page.goto(`${process.env.PARTNER_URL}/topup`, {
      waitUntil: 'networkidle'
    });

    // ── กรอก Player UID ──────────────────────────────────────
    // ✏️  เปลี่ยน '#player-id' ให้ตรงกับ HTML ของ partner
    await this.page.fill('#player-id', userId);
    await this.page.waitForTimeout(400 + Math.random() * 400);

    // ── กด Verify (ถ้ามีปุ่ม Check ID) ─────────────────────
    const verifyBtn = await this.page.$('#verify-btn, .check-id-btn');
    if (verifyBtn) {
      await verifyBtn.click();
      // รอให้ verify เสร็จ (อาจมี loading)
      await this.page.waitForSelector('.player-name, .verified-badge', {
        timeout: 15000
      });
      console.log('✅ Verify UID สำเร็จ');
    }

    // ── เลือก Package ────────────────────────────────────────
    // วิธีที่ 1: dropdown select
    // await this.page.selectOption('#package-select', packageId);
    
    // วิธีที่ 2: คลิกที่ card/button ของ package
    await this.page.click(`[data-package-id="${packageId}"]`);
    await this.page.waitForTimeout(300);

    // ── Screenshot ก่อน Submit (เก็บหลักฐาน) ────────────────
    await this.screenshot(orderId, 'before-submit');

    // ── กด Submit ────────────────────────────────────────────
    await this.page.click('#submit-topup, .confirm-btn');
    
    // ── รอ Confirmation ──────────────────────────────────────
    // รอ element ที่บอกว่า "สำเร็จ" ปรากฏขึ้น
    await this.page.waitForSelector('.success-message, .topup-success, #result', {
      timeout: 30000
    });

    // ดึงข้อความผลลัพธ์
    const resultText = await this.page.textContent('.success-message, .topup-success, #result')
      .catch(() => 'Success');

    // ── Screenshot หลัง Submit (proof สำหรับ dispute) ────────
    await this.screenshot(orderId, 'completed');
    
    console.log(`✅ Order ${orderId} สำเร็จ: ${resultText}`);
    
    return {
      success: true,
      resultText,
      screenshotPath: `${SCREENSHOT_DIR}/${orderId}-completed.png`,
      completedAt: new Date().toISOString(),
    };
  }

  // ----------------------------------------------------------
  // Helper: ถ่าย Screenshot
  // ----------------------------------------------------------
  async screenshot(orderId, step) {
    const filePath = path.join(SCREENSHOT_DIR, `${orderId}-${step}.png`);
    await this.page.screenshot({ path: filePath, fullPage: true });
    console.log(`📸 Screenshot: ${filePath}`);
    return filePath;
  }

  // ----------------------------------------------------------
  // ปิด Browser (เรียกตอนเสร็จงาน)
  // ----------------------------------------------------------
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 ปิด Browser แล้ว');
    }
  }

  // ----------------------------------------------------------
  // ฟังก์ชันหลัก: รวม launch + login + processTopup
  // Worker จะเรียกฟังก์ชันนี้อันเดียว
  // ----------------------------------------------------------
  async run(orderData) {
    try {
      await this.launch();
      await this.login();
      const result = await this.processTopup(orderData);
      return result;
    } finally {
      // ปิด browser ไม่ว่าจะสำเร็จหรือ error
      await this.close();
    }
  }
}
