const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest.json');
const { getStreams } = require('./scraper');

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    const parts = id.split(':');
    const imdbId = parts[0];
    const season = parseInt(parts[1]) || 1;
    const episode = parseInt(parts[2]) || 1;

    console.log(`🔍 طلب: ${imdbId} | نوع: ${type} | موسم: ${season} | حلقة: ${episode}`);
    const streams = await getStreams(imdbId, type, season, episode);
    return { streams };
});

const addonInterface = builder.getInterface();

module.exports = async (req, res) => {
    // CORS ضروري لـ Stremio
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const url = new URL(req.url, `https://${req.headers.host}`);
    const path = url.pathname;

    try {
        // manifest
        if (path === '/manifest.json' || path === '/') {
            return res.status(200).json(addonInterface.manifest);
        }

        // stream
        if (path.startsWith('/stream/')) {
            const segments = path.split('/');
            const type = segments[2];          // movie أو series
            const id = decodeURIComponent(segments[3]);
            const result = await addonInterface.get('stream', type, id);
            return res.status(200).json(result);
        }

        res.status(404).json({ error: 'Not found' });
    } catch (error) {
        console.error('Server error:', error.message);
        res.status(500).json({ error: error.message });
    }
};
