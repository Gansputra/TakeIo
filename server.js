const express = require('express');
const ytdl = require('@distube/ytdl-core');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const downloadPath = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

// --- LOAD COOKIES (Biar Gak Kena 403) ---
let agent;
try {
    const cookieData = JSON.parse(fs.readFileSync(path.join(__dirname, 'cookies.json')));
    agent = ytdl.createAgent(cookieData);
    console.log('[TakeIo] Cookies loaded! Siap tempur. ✅');
} catch (err) {
    console.error('[TakeIo] cookies.json gak ketemu atau error. ❌');
}

// 1. Ambil Info Video (Preview)
app.get('/info', async (req, res) => {
    const { url } = req.query;
    if (!ytdl.validateURL(url)) return res.status(400).json({ success: false });
    try {
        const info = await ytdl.getBasicInfo(url, { agent });
        res.json({
            success: true,
            title: info.videoDetails.title,
            author: info.videoDetails.author.name,
            thumbnail: info.videoDetails.thumbnails.pop().url
        });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 2. Download MP4 (Video)
app.post('/download', async (req, res) => {
    const { url, socketId } = req.body;
    try {
        const info = await ytdl.getInfo(url, { agent });
        const cleanTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '');
        const fileName = `${cleanTitle}_${Date.now()}.mp4`;
        const filePath = path.join(downloadPath, fileName);

        const video = ytdl(url, { 
            agent, 
            quality: 'highestvideo', 
            filter: 'audioandvideo' 
        });

        video.on('progress', (_, downloaded, total) => {
            const progress = (downloaded / total) * 100;
            io.to(socketId).emit('downloadProgress', { progress, status: 'Downloading Video...' });
        });

        video.pipe(fs.createWriteStream(filePath)).on('finish', () => {
            res.json({ success: true, fileName });
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'YouTube blokir akses (403). Ganti cookies!' });
    }
});

// 3. Convert MP4 Lokal ke MP3
app.post('/upload-convert', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'File kosong!' });

    const inputFile = req.file.path;
    const originalName = req.file.originalname.replace(/\.[^/.]+$/, ""); // Ambil nama asli tanpa ekstensi
    const outputName = `TakeIo_Converted_${Date.now()}.mp3`;
    const outputPath = path.join(downloadPath, outputName);

    console.log(`[TakeIo] Converting: ${req.file.originalname}`);

    // Proses FFmpeg
    ffmpeg(inputFile)
        .toFormat('mp3')
        .on('end', () => {
            fs.unlinkSync(inputFile); // Hapus file video original di folder uploads
            res.json({ success: true, fileName: outputName });
        })
        .on('error', (err) => {
            if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
            res.status(500).json({ success: false });
        })
        .save(outputPath);
});
// 4. List File & Download ke Browser
app.get('/list-files', (req, res) => {
    fs.readdir(downloadPath, (err, files) => {
        res.json({ files: files.filter(f => f.endsWith('.mp4') || f.endsWith('.mp3')) });
    });
});

app.get('/get-file/:name', (req, res) => {
    res.download(path.join(downloadPath, req.params.name));
});

server.listen(3000, () => console.log('TAKE.IO Ready at http://localhost:3000 🚀'));