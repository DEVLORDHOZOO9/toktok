#!/bin/bash

echo "🔧 HOZOO MD - TikTok Reporter Setup"
echo "======================================"

# Update system
sudo apt update

# Install Node.js
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install Tor
echo "🔌 Installing Tor..."
sudo apt install -y tor

# Install PM2
sudo npm install -g pm2

# Start Tor
sudo systemctl start tor
sudo systemctl enable tor

# Create directories
mkdir -p assets logs

# Check if video exists
if [ ! -f "./assets/hozoo.mp4" ]; then
    echo "📹 Please add hozoo.mp4 to assets folder for welcome video"
fi

# Install dependencies
echo "📦 Installing npm dependencies..."
npm install

# Setup completed
echo "✅ Setup completed!"
echo ""
echo "🎯 NEXT STEPS:"
echo "1. Edit TELEGRAM_CONFIG in tiktok-bot.js"
echo "2. Add your Bot Token and Chat ID"
echo "3. Place hozoo.mp4 in assets folder"
echo "4. Run: npm start"
echo ""
echo "🤖 Bot Commands:"
echo "   /start - Show main menu"
echo "   /ban [uid] - Ban account"
echo "   /check [uid] - Check account"
echo "   /stats - Show statistics"
