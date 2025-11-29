#!/usr/bin/env node

const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const SocksProxyAgent = require('socks-proxy-agent');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const ora = require('ora');
const figlet = require('figlet');
const moment = require('moment-timezone');
const userAgents = require('user-agents');
const fs = require('fs');
const path = require('path');

// Konfigurasi Telegram Bot
const TELEGRAM_CONFIG = {
    BOT_TOKEN: '8369000292:AAFhrncymw4_zj5mRM6Trj5PtFNzwOAjTDU', // Ganti dengan token bot Anda
    CHAT_ID: '8317643774', // Ganti dengan chat ID Anda
    ADMIN_IDS: ['8317643774'] // ID admin yang diizinkan
};

// Konfigurasi TikTok Reporter
const TIKTOK_CONFIG = {
    PROXY_HOST: '127.0.0.1',
    PROXY_PORT: 9050,
    MAX_REPORTS: 3,
    DELAY_BETWEEN_REPORTS: 3000,
    REQUEST_TIMEOUT: 10000
};

// Inisialisasi Telegram Bot
const bot = new Telegraf(TELEGRAM_CONFIG.BOT_TOKEN);

// Data storage
let userSessions = new Map();
let reportStats = {
    totalReports: 0,
    successfulReports: 0,
    blockedAccounts: 0,
    lastActivity: null
};

// Fungsi untuk mendapatkan info waktu lengkap
function getDetailedTimeInfo() {
    const now = moment().tz('Asia/Jakarta');
    return {
        date: now.format('YYYY-MM-DD'),
        time: now.format('HH:mm:ss'),
        day: now.format('dddd'),
        month: now.format('MMMM'),
        year: now.format('YYYY'),
        timestamp: now.valueOf(),
        timezone: 'WIB (UTC+7)',
        sunrise: '05:30 WIB', // Perkiraan sunrise
        sunset: '17:45 WIB',   // Perkiraan sunset
        moonPhase: getMoonPhase(now.date())
    };
}

// Fungsi untuk fase bulan (simulasi sederhana)
function getMoonPhase(day) {
    const phases = ['🌑 Bulan Baru', '🌒 Bulan Sabit Awal', '🌓 Bulan Separuh Awal', 
                   '🌔 Bulan Cembung Awal', '🌕 Bulan Purnama', '🌖 Bulan Cembung Akhir',
                   '🌗 Bulan Separuh Akhir', '🌘 Bulan Sabit Akhir'];
    return phases[day % 8];
}

// Fungsi untuk menampilkan banner
function showBanner() {
    console.log(chalk.cyan(figlet.textSync('HOZOO MD', { horizontalLayout: 'full' })));
    console.log(chalk.yellow('🤖 TikTok Account Reporter Bot'));
    console.log(chalk.yellow('📅 ' + getDetailedTimeInfo().date));
    console.log(chalk.yellow('⏰ ' + getDetailedTimeInfo().time));
    console.log(chalk.yellow('=========================================\n'));
}

// Fungsi untuk mengirim notifikasi ke Telegram
async function sendTelegramNotification(chatId, message, options = {}) {
    try {
        await bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            ...options
        });
        return true;
    } catch (error) {
        console.log(chalk.red('❌ Telegram send error:', error.message));
        return false;
    }
}

// Fungsi untuk mengecek status akun TikTok
async function checkAccountStatus(uid) {
    const spinner = ora('Checking TikTok account...').start();
    
    try {
        const proxyAgent = new SocksProxyAgent(`socks5://${TIKTOK_CONFIG.PROXY_HOST}:${TIKTOK_CONFIG.PROXY_PORT}`);
        const userAgent = new userAgents().toString();

        const response = await axios({
            method: 'get',
            url: `https://www.tiktok.com/node/share/user/@${uid}`,
            httpsAgent: proxyAgent,
            headers: {
                'User-Agent': userAgent,
                'Accept': 'application/json',
            },
            timeout: TIKTOK_CONFIG.REQUEST_TIMEOUT,
        });

        if (response.data?.userInfo?.user) {
            const user = response.data.userInfo.user;
            spinner.succeed(chalk.green('Account found'));
            return {
                exists: true,
                blocked: false,
                username: user.uniqueId || 'Unknown',
                nickname: user.nickname || 'Unknown',
                followers: user.followerCount || 0,
                verified: user.verified || false
            };
        }
        
        spinner.warn(chalk.yellow('Account not found'));
        return { exists: false, blocked: false };

    } catch (error) {
        if (error.response?.status === 404 || error.response?.status === 403) {
            spinner.succeed(chalk.green('Account blocked or not found'));
            return { exists: false, blocked: true };
        }
        
        spinner.fail(chalk.red('Check failed'));
        return { exists: false, blocked: false, error: error.message };
    }
}

// Fungsi untuk melakukan report
async function reportTikTokAccount(uid, reason = 'Pelanggaran Kekayaan Intelektual') {
    const spinner = ora('Sending report...').start();
    
    try {
        const proxyAgent = new SocksProxyAgent(`socks5://${TIKTOK_CONFIG.PROXY_HOST}:${TIKTOK_CONFIG.PROXY_PORT}`);
        const userAgent = new userAgents().toString();

        const response = await axios({
            method: 'post',
            url: 'https://www.tiktok.com/api/report/user/',
            httpsAgent: proxyAgent,
            data: new URLSearchParams({
                object_id: uid,
                report_type: 'user',
                reason: '100', // Intellectual Property
                additional_info: '',
                timestamp: Date.now().toString(),
            }).toString(),
            headers: {
                'User-Agent': userAgent,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `https://www.tiktok.com/@user${uid}`,
            },
            timeout: TIKTOK_CONFIG.REQUEST_TIMEOUT,
        });

        spinner.succeed(chalk.green('Report sent'));
        
        reportStats.totalReports++;
        if (response.data?.status_code === 0) {
            reportStats.successfulReports++;
        }
        
        return {
            success: response.data?.status_code === 0,
            report_id: response.data?.report_id,
            message: response.data?.message || 'Unknown response'
        };

    } catch (error) {
        spinner.fail(chalk.red('Report failed'));
        return {
            success: false,
            error: error.message
        };
    }
}

// Fungsi multiple reports
async function performMassReport(uid, count = 3) {
    const results = [];
    const progressBar = new cliProgress.SingleBar({
        format: 'Progress |{bar}| {percentage}% | {value}/{total} Reports',
        barCompleteChar: '█',
        barIncompleteChar: '░',
    });

    progressBar.start(count, 0);

    for (let i = 0; i < count; i++) {
        const result = await reportTikTokAccount(uid);
        results.push(result);
        progressBar.update(i + 1);
        
        if (i < count - 1) {
            await new Promise(resolve => setTimeout(resolve, TIKTOK_CONFIG.DELAY_BETWEEN_REPORTS));
        }
    }

    progressBar.stop();
    return results;
}

// ===============================
// TELEGRAM BOT HANDLERS
// ===============================

// Start command dengan video dan menu
bot.start(async (ctx) => {
    const timeInfo = getDetailedTimeInfo();
    const welcomeMessage = `🎬 <b>HOZOO MD - TikTok Reporter</b>

🕒 <b>Info Waktu:</b>
📅 ${timeInfo.day}, ${timeInfo.date}
⏰ ${timeInfo.time} ${timeInfo.timezone}
🌅 Sunrise: ${timeInfo.sunrise}
🌇 Sunset: ${timeInfo.sunset}
${timeInfo.moonPhase}

👋 <b>Selamat datang di Hozoo MD!</b>

Fitur yang tersedia:
✅ Ban TikTok Account
✅ Mass Report System  
✅ Account Status Check
✅ Real-time Monitoring

Pilih menu di bawah untuk memulai:`;

    try {
        // Kirim video terlebih dahulu
        await ctx.replyWithVideo(
            { source: './assets/hozoo.mp4' }, // Pastikan file hozoo.mp4 ada di folder assets
            {
                caption: '🎥 HOZOO MD - TikTok Account Ban System',
                parse_mode: 'HTML'
            }
        );

        // Kirim menu interaktif
        await ctx.reply(welcomeMessage, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🚀 Ban Account', 'ban_account')],
                [Markup.button.callback('🔍 Check Account', 'check_account')],
                [Markup.button.callback('📊 Statistics', 'show_stats')],
                [Markup.button.callback('🆘 Help', 'show_help')]
            ])
        });
    } catch (error) {
        // Jika video tidak ada, kirim pesan biasa
        await ctx.reply(welcomeMessage, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🚀 Ban Account', 'ban_account')],
                [Markup.button.callback('🔍 Check Account', 'check_account')],
                [Markup.button.callback('📊 Statistics', 'show_stats')],
                [Markup.button.callback('🆘 Help', 'show_help')]
            ])
        });
    }
});

// Handler untuk button Ban Account
bot.action('ban_account', async (ctx) => {
    await ctx.answerCbQuery();
    
    const banMessage = `🚀 <b>BAN TIKTOK ACCOUNT</b>

Silakan kirim <b>UID TikTok</b> yang ingin di-ban:

Contoh: <code>7951781611</code>

Atau kirim username: <code>@username</code>

Fitur ini akan:
✅ Melakukan mass report
✅ Memantau status akun
✅ Notifikasi ketika berhasil di-ban

<b>⚠️ Gunakan dengan bijak!</b>`;

    await ctx.reply(banMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Kembali', 'back_to_main')]
        ])
    });

    // Set state untuk menunggu input UID
    userSessions.set(ctx.from.id, { waitingFor: 'uid_ban' });
});

// Handler untuk button Check Account
bot.action('check_account', async (ctx) => {
    await ctx.answerCbQuery();
    
    const checkMessage = `🔍 <b>CHECK ACCOUNT STATUS</b>

Kirim <b>UID TikTok</b> untuk mengecek status:

• Akun aktif atau tidak
• Jumlah followers
• Verified status
• Dan informasi lainnya`;

    await ctx.reply(checkMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Kembali', 'back_to_main')]
        ])
    });

    userSessions.set(ctx.from.id, { waitingFor: 'uid_check' });
});

// Handler untuk button Statistics
bot.action('show_stats', async (ctx) => {
    await ctx.answerCbQuery();
    
    const timeInfo = getDetailedTimeInfo();
    const statsMessage = `📊 <b>STATISTICS REPORT</b>

🕒 <b>Waktu Sistem:</b>
${timeInfo.day}, ${timeInfo.date}
${timeInfo.time} ${timeInfo.timezone}

📈 <b>Report Statistics:</b>
• Total Reports: ${reportStats.totalReports}
• Successful: ${reportStats.successfulReports}
• Accounts Blocked: ${reportStats.blockedAccounts}
• Success Rate: ${reportStats.totalReports > 0 ? 
    ((reportStats.successfulReports / reportStats.totalReports) * 100).toFixed(1) : 0}%

🌐 <b>System Info:</b>
• Bot Status: 🟢 Online
• Last Activity: ${reportStats.lastActivity || 'No activity'}
• Memory Usage: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;

    await ctx.reply(statsMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'show_stats')],
            [Markup.button.callback('⬅️ Kembali', 'back_to_main')]
        ])
    });
});

// Handler untuk button Help
bot.action('show_help', async (ctx) => {
    await ctx.answerCbQuery();
    
    const helpMessage = `🆘 <b>HELP & GUIDE</b>

<b>Perintah yang tersedia:</b>
/start - Memulai bot dan menampilkan menu
/ban [uid] - Ban account TikTok
/check [uid] - Cek status account
/stats - Lihat statistics
/help - Bantuan ini

<b>Cara penggunaan:</b>
1. Klik "Ban Account"
2. Kirim UID target
3. Bot akan melakukan mass report
4. Dapatkan notifikasi ketika berhasil

<b>Format UID:</b>
• Numeric: <code>7951781611</code>
• Username: <code>@username</code>

<b>⚠️ Disclaimer:</b>
Gunakan tool ini hanya untuk tujuan edukasi dan akun yang melanggar hukum.`;

    await ctx.reply(helpMessage, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Kembali', 'back_to_main')]
        ])
    });
});

// Handler untuk kembali ke main menu
bot.action('back_to_main', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    userSessions.delete(ctx.from.id);
    
    // Trigger start command
    await bot.handleUpdate({...ctx.update, message: { ...ctx.update.callback_query.message, text: '/start' }});
});

// Handler untuk pesan teks (input UID)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const userInput = ctx.message.text.trim();
    const session = userSessions.get(userId);

    // Handle command langsung
    if (userInput.startsWith('/')) {
        const command = userInput.split(' ')[0];
        const argument = userInput.split(' ')[1];

        switch (command) {
            case '/ban':
                if (argument) {
                    await processBanRequest(ctx, argument);
                } else {
                    await ctx.reply('❌ Format: /ban [UID]\nContoh: /ban 7951781611');
                }
                return;
                
            case '/check':
                if (argument) {
                    await processCheckRequest(ctx, argument);
                } else {
                    await ctx.reply('❌ Format: /check [UID]\nContoh: /check 7951781611');
                }
                return;
                
            case '/stats':
                await bot.handleUpdate({...ctx.update, callback_query: { ...ctx.update.message, data: 'show_stats' }});
                return;
                
            case '/help':
                await bot.handleUpdate({...ctx.update, callback_query: { ...ctx.update.message, data: 'show_help' }});
                return;
        }
    }

    // Handle session-based input
    if (session) {
        switch (session.waitingFor) {
            case 'uid_ban':
                await processBanRequest(ctx, userInput);
                userSessions.delete(userId);
                break;
                
            case 'uid_check':
                await processCheckRequest(ctx, userInput);
                userSessions.delete(userId);
                break;
        }
    } else {
        await ctx.reply('🤖 Silakan pilih menu dari keyboard atau ketik /start untuk memulai.');
    }
});

// Fungsi untuk memproses request ban
async function processBanRequest(ctx, uid) {
    const processingMsg = await ctx.reply('🔄 <b>Memproses ban request...</b>', { 
        parse_mode: 'HTML' 
    });

    try {
        // Cek status akun terlebih dahulu
        const status = await checkAccountStatus(uid);
        
        if (!status.exists) {
            if (status.blocked) {
                await ctx.editMessageText(
                    `✅ <b>AKUN SUDAH DIBLOKIR!</b>\n\nUID: <code>${uid}</code>\n\nAkun ini sudah tidak aktif atau telah diblokir oleh TikTok.`,
                    { 
                        parse_mode: 'HTML',
                        message_id: processingMsg.message_id 
                    }
                );
            } else {
                await ctx.editMessageText(
                    `❌ <b>AKUN TIDAK DITEMUKAN</b>\n\nUID: <code>${uid}</code>\n\nPastikan UID atau username benar.`,
                    { 
                        parse_mode: 'HTML',
                        message_id: processingMsg.message_id 
                    }
                );
            }
            return;
        }

        // Kirim info akun
        await ctx.editMessageText(
            `🔍 <b>ACCOUNT DITEMUKAN</b>\n\n` +
            `👤 Username: <code>${status.username}</code>\n` +
            `📛 Nickname: ${status.nickname}\n` +
            `👥 Followers: ${status.followers.toLocaleString()}\n` +
            `✅ Verified: ${status.verified ? 'Yes' : 'No'}\n\n` +
            `🚀 <b>Memulai mass report...</b>`,
            { 
                parse_mode: 'HTML',
                message_id: processingMsg.message_id 
            }
        );

        // Lakukan mass report
        const reportResults = await performMassReport(uid, TIKTOK_CONFIG.MAX_REPORTS);
        const successfulReports = reportResults.filter(r => r.success).length;

        // Update statistics
        reportStats.lastActivity = new Date().toLocaleString();

        // Kirim hasil
        const resultMessage = `📊 <b>REPORT COMPLETED</b>\n\n` +
            `🎯 Target: <code>${uid}</code>\n` +
            `👤 Username: ${status.username}\n` +
            `✅ Successful Reports: ${successfulReports}/${TIKTOK_CONFIG.MAX_REPORTS}\n` +
            `📈 Success Rate: ${((successfulReports / TIKTOK_CONFIG.MAX_REPORTS) * 100).toFixed(1)}%\n\n` +
            `⏰ Waktu: ${getDetailedTimeInfo().time} ${getDetailedTimeInfo().timezone}\n\n` +
            `ℹ️ <i>TikTok akan mereview reports dalam 24-48 jam.</i>`;

        await ctx.editMessageText(resultMessage, { 
            parse_mode: 'HTML',
            message_id: processingMsg.message_id,
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔄 Check Status', `check_${uid}`)],
                [Markup.button.callback('🎯 Ban Lain', 'ban_account')],
                [Markup.button.callback('🏠 Main Menu', 'back_to_main')]
            ])
        });

        // Kirim notifikasi ke admin
        if (TELEGRAM_CONFIG.ADMIN_IDS.includes(ctx.from.id.toString())) {
            await sendTelegramNotification(
                ctx.from.id,
                `👮 <b>ADMIN NOTIFICATION</b>\n\n` +
                `User ${ctx.from.first_name} melakukan report:\n` +
                `Target: ${status.username} (${uid})\n` +
                `Results: ${successfulReports}/${TIKTOK_CONFIG.MAX_REPORTS} successful`
            );
        }

    } catch (error) {
        await ctx.editMessageText(
            `❌ <b>ERROR</b>\n\nGagal memproses request: ${error.message}`,
            { 
                parse_mode: 'HTML',
                message_id: processingMsg.message_id 
            }
        );
    }
}

// Fungsi untuk memproses request check
async function processCheckRequest(ctx, uid) {
    const processingMsg = await ctx.reply('🔍 <b>Checking account status...</b>', { 
        parse_mode: 'HTML' 
    });

    try {
        const status = await checkAccountStatus(uid);
        const timeInfo = getDetailedTimeInfo();

        let statusMessage;
        if (status.exists) {
            statusMessage = `✅ <b>ACCOUNT ACTIVE</b>\n\n` +
                `👤 Username: <code>${status.username}</code>\n` +
                `📛 Nickname: ${status.nickname}\n` +
                `👥 Followers: ${status.followers.toLocaleString()}\n` +
                `✅ Verified: ${status.verified ? 'Yes' : 'No'}\n\n` +
                `🕒 Check Time: ${timeInfo.time} ${timeInfo.timezone}\n\n` +
                `<i>Akun ini masih aktif dan dapat dilaporkan.</i>`;
        } else if (status.blocked) {
            statusMessage = `❌ <b>ACCOUNT BLOCKED</b>\n\n` +
                `UID: <code>${uid}</code>\n\n` +
                `Akun ini sudah diblokir atau tidak aktif.\n` +
                `🕒 Check Time: ${timeInfo.time} ${timeInfo.timezone}`;
        } else {
            statusMessage = `❌ <b>ACCOUNT NOT FOUND</b>\n\n` +
                `UID: <code>${uid}</code>\n\n` +
                `Akun tidak ditemukan. Pastikan UID benar.`;
        }

        await ctx.editMessageText(statusMessage, { 
            parse_mode: 'HTML',
            message_id: processingMsg.message_id,
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🚀 Ban Account', 'ban_account')],
                [Markup.button.callback('🔄 Check Again', `check_${uid}`)],
                [Markup.button.callback('🏠 Main Menu', 'back_to_main')]
            ])
        });

    } catch (error) {
        await ctx.editMessageText(
            `❌ <b>CHECK ERROR</b>\n\nGagal mengecek status: ${error.message}`,
            { 
                parse_mode: 'HTML',
                message_id: processingMsg.message_id 
            }
        );
    }
}

// Handler untuk check specific account
bot.action(/check_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.match[1];
    await processCheckRequest(ctx, uid);
});

// Error handling
bot.catch((err, ctx) => {
    console.log(chalk.red(`Telegram Bot Error: ${err}`));
    ctx.reply('❌ Terjadi error, silakan coba lagi.');
});

// ===============================
// START APPLICATION
// ===============================

async function startApplication() {
    showBanner();
    
    try {
        // Start Telegram Bot
        console.log(chalk.blue('🤖 Starting Telegram Bot...'));
        await bot.launch();
        console.log(chalk.green('✅ Telegram Bot started successfully!'));
        
        // Kirim startup notification ke admin
        const timeInfo = getDetailedTimeInfo();
        const startupMessage = `🟢 <b>HOZOO MD BOT STARTED</b>\n\n` +
            `📅 ${timeInfo.day}, ${timeInfo.date}\n` +
            `⏰ ${timeInfo.time} ${timeInfo.timezone}\n` +
            `🌐 System: Ubuntu/VPS\n` +
            `🤖 Status: Online and Ready`;

        for (const adminId of TELEGRAM_CONFIG.ADMIN_IDS) {
            await sendTelegramNotification(adminId, startupMessage);
        }

        console.log(chalk.green('🎉 Application ready! Bot is listening for messages...'));
        
        // Graceful shutdown
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));

    } catch (error) {
        console.log(chalk.red('❌ Failed to start application:'), error);
        process.exit(1);
    }
}

// Jalankan aplikasi
startApplication();
