const express = require("express");
const cors = require("cors");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const privateIp = "10.40.40.49";
const port = 3001;

const streamsDir = path.join(__dirname, "streams");
if (!fs.existsSync(streamsDir)) {
  fs.mkdirSync(streamsDir);
}

let cameras = [];
const processes = {};

function sanitizeFolderName(ip) {
  return "hls_" + ip.replace(/\./g, "_");
}

function startStream(ip, username, password, folder) {
  const rtspUrl = `rtsp://${username}:${password}@${ip}:554/Streaming/Channels/101`;
  const hlsFolder = path.join(streamsDir, folder);

  if (!fs.existsSync(hlsFolder)) {
    fs.mkdirSync(hlsFolder, { recursive: true });
  }

  // Remove previous segments
  fs.readdirSync(hlsFolder).forEach((file) => {
    fs.unlinkSync(path.join(hlsFolder, file));
  });

  console.log(`Starting low-latency stream for ${ip} → ${folder}`);

  const ffmpegProcess = spawn("ffmpeg", [
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-i", rtspUrl,
    "-flags", "low_delay",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-b:v", "800k",
    "-bufsize", "800k",
    "-max_delay", "100000",
    "-g", "25",
    "-an",
    "-f", "hls",
    "-hls_time", "0.3",
    "-hls_list_size", "2",
    "-hls_flags", "delete_segments+append_list+omit_endlist",
    "-hls_segment_type", "mpegts",
    "-hls_allow_cache", "0",
    "-start_number", "0",
    path.join(hlsFolder, "stream.m3u8"),
  ]);

  ffmpegProcess.stderr.on("data", (data) => {
    console.error(`FFmpeg error (${ip}): ${data}`);
  });

  ffmpegProcess.on("close", (code) => {
    console.log(`FFmpeg for ${ip} exited with code ${code}`);
    delete processes[ip];
  });

  processes[ip] = ffmpegProcess;
}

app.post("/api/cameras", (req, res) => {
  const { ip, username, password } = req.body;
  if (!ip || !username || !password) {
    return res.status(400).json({ error: "ip, username, and password are required." });
  }
  if (cameras.find((cam) => cam.ip === ip)) {
    return res.status(400).json({ error: "Camera already added." });
  }
  const folder = sanitizeFolderName(ip);
  const newCamera = { ip, username, password, folder };
  cameras.push(newCamera);
  startStream(ip, username, password, folder);
  res.json(newCamera);
});

app.get("/api/cameras", (req, res) => {
  res.json(cameras);
});

// New API to remove a camera
app.delete("/api/cameras/:ip", (req, res) => {
  const { ip } = req.params;
  const cameraIndex = cameras.findIndex((cam) => cam.ip === ip);
  
  if (cameraIndex === -1) {
    return res.status(404).json({ error: "Camera not found." });
  }

  // Stop and remove FFmpeg process
  if (processes[ip]) {
    processes[ip].kill();
    delete processes[ip];
  }

  // Remove HLS stream folder
  const folder = sanitizeFolderName(ip);
  const hlsFolder = path.join(streamsDir, folder);
  if (fs.existsSync(hlsFolder)) {
    fs.rmSync(hlsFolder, { recursive: true, force: true });
  }

  // Remove camera from the list
  cameras.splice(cameraIndex, 1);
  
  res.json({ message: `Camera ${ip} removed successfully.` });
});

app.use("/streams", express.static(streamsDir));

app.get("/hls/combined.m3u8", (req, res) => {
  let combinedPlaylist = "#EXTM3U\n";
  cameras.forEach(({ folder }) => {
    combinedPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=1000000\n/streams/${folder}/stream.m3u8\n`;
  });
  res.setHeader("Content-Type", "application/x-mpegURL");
  res.send(combinedPlaylist);
});

app.get("/api/status", (req, res) => {
  const status = cameras.map(({ ip }) => ({
    ip,
    running: !!processes[ip] && !processes[ip].killed,
  }));
  res.json(status);
});

app.get("/api/ip", (req, res) => {
  res.json({ ip: privateIp });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running at http://${privateIp}:${port}`);
});