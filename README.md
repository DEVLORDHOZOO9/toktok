# toktok

# Berikan permission
chmod +x setup.sh tiktok-bot.js

# Jalankan setup
./setup.sh

# Edit configurasi bot
nano tiktok-bot.js
# Ganti YOUR_TELEGRAM_BOT_TOKEN dan YOUR_CHAT_ID

# Tambahkan video welcome (opsional)
# Letakkan file hozoo.mp4 di folder assets/

# Jalankan bot
npm start

# Atau dengan PM2
pm2 start tiktok-bot.js --name "hozoo-bot"
