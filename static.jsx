const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
app.use(cors());

const privateIp = "192.168.0.116";  
const port = 3001;

// List of all cameras
const cameras = [
    { ip: "10.40.42.24", folder: "hls_cam2" },
    { ip: "10.40.42.12", folder: "hls_cam3" },
    { ip: "10.40.42.35", folder: "hls_cam4" },
    { ip: "10.40.42.41", folder: "hls_cam5" },
    { ip: "10.40.42.53", folder: "hls_cam6" },
    { ip: "10.40.42.55", folder: "hls_cam7" },
    { ip: "10.40.42.81", folder: "hls_cam8" },
    { ip: "10.40.42.84", folder: "hls_cam9" },
    { ip: "10.40.42.31", folder: "hls_cam10" },
    { ip: "10.40.42.83", folder: "hls_cam11" },
    { ip: "10.40.42.71", folder: "hls_cam12" },
    { ip: "10.40.42.20", folder: "hls_cam13" },
    { ip: "10.40.42.33", folder: "hls_cam14" },
    { ip: "10.40.42.113", folder: "hls_cam15" },
    { ip: "10.40.42.11", folder: "hls_cam16" },
    { ip: "10.40.42.115", folder: "hls_cam17" },
];

const processes = {};

// Function to start a low-latency HLS stream
function startStream(ip, folder) {
    const rtspUrl = `rtsp://admin:Ctas%40sunic123@${ip}:554/Streaming/Channels/101`;
    const hlsFolder = path.join(__dirname, folder);

    if (!fs.existsSync(hlsFolder)) {
        fs.mkdirSync(hlsFolder, { recursive: true });
    }

    fs.readdirSync(hlsFolder).forEach((file) => fs.unlinkSync(path.join(hlsFolder, file)));

    console.log(`Starting low-latency stream for ${ip} → ${folder}`);

    const ffmpegProcess = spawn("ffmpeg", [
        "-rtsp_transport", "tcp",
        "-i", rtspUrl,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-b:v", "800k",
        "-bufsize", "800k",
        "-max_delay", "200000", 
        "-g", "25",  
        "-an",  
        "-f", "hls",
        "-hls_time", "0.5",  
        "-hls_list_size", "2",  
        "-hls_flags", "delete_segments+append_list",
        "-hls_segment_type", "mpegts",
        "-hls_allow_cache", "0",
        "-start_number", "0",
        path.join(hlsFolder, "stream.m3u8"),
    ]);

    ffmpegProcess.stderr.on("data", (data) => {
        console.error(`FFmpeg error (${ip}): ${data}`);
    });

    ffmpegProcess.on("close", (code) => {
        console.log(`FFmpeg for ${ip} exited with code ${code}, restarting...`);
        setTimeout(() => startStream(ip, folder), 5000);
    });

    processes[ip] = ffmpegProcess;
}

// Start streams for all cameras
cameras.forEach(({ ip, folder }) => startStream(ip, folder));

// Serve HLS streams
cameras.forEach(({ folder }) => {
    app.use(`/${folder}`, express.static(path.join(__dirname, folder)));
});

// API to get combined playlist
app.get("/hls/combined.m3u8", (req, res) => {
    let combinedPlaylist = "#EXTM3U\n";
    cameras.forEach(({ folder }) => {
        combinedPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=1000000\n/${folder}/stream.m3u8\n`;
    });
    res.setHeader("Content-Type", "application/x-mpegURL");
    res.send(combinedPlaylist);
});

// API to check camera status
app.get("/api/status", (req, res) => {
    const status = cameras.map(({ ip }) => ({
        ip,
        running: !!processes[ip] && !processes[ip].killed,
    }));
    res.json(status);
});

// API to get private IP
app.get("/api/ip", (req, res) => {
    res.json({ ip: privateIp });
});


// Start the server
app.listen(port, "0.0.0.0", () => {
    console.log(`Server running at http://${privateIp}:${port}`);
});

