const { addonBuilder } = require('stremio-addon-sdk');
const manifest = require('./manifest.json');
const {
    getStreams,
    getMovieCatalog,
    getSeriesCatalog
} = require('./scraper');
const fs = require('fs');
const path = require('path');

const builder = new addonBuilder(manifest);

// ============================================================
// الكتالوج
// ============================================================
builder.defineCatalogHandler(async (args) => {
    const { id } = args;
    console.log(`📚 كتالوج: ${id}`);
    let metas = [];

    try {
        if (id === 'alooy-movies') metas = await getMovieCatalog();
        if (id === 'alooy-series') metas = await getSeriesCatalog();
        console.log(`✅ ${metas.length} عنصر`);
    } catch (e) {
        console.error('❌ خطأ كتالوج:', e.message);
    }

    return { metas };
});

// ============================================================
// Stream
// ============================================================
builder.defineStreamHandler(async (args) => {
    const { id, type } = args;
    const parts = id.split(':');
    const slug = parts[1];
    const season = parseInt(parts[2]) || 1;
    const episode = parseInt(parts[3]) || 1;

    console.log(`🔍 stream: ${slug} | ${type} | S${season}E${episode}`);
    const streams = await getStreams(id, type, season, episode);
    console.log(`✅ ${streams.length} سيرفر`);
    return { streams };
});

const addonInterface = builder.getInterface();

// ============================================================
// الواجهة
// ============================================================
let uiHtml = '';
try {
    uiHtml = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf-8');
} catch (e) {
    console.error('ما لقيت ui.html:', e.message);
}

// ============================================================
// Vercel Handler
// ============================================================
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const url = new URL(req.url, `https://${req.headers.host}`);
    const pathname = url.pathname;

    try {
        if (pathname === '/' || pathname === '/ui') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(uiHtml);
        }

        if (pathname === '/manifest.json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.status(200).json(addonInterface.manifest);
        }

        if (pathname.startsWith('/catalog/')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            const segments = pathname.split('/');
            const type = segments[2];
            const id = decodeURIComponent(segments[3]);
            const result = await addonInterface.get('catalog', type, id);
            return res.status(200).json(result);
        }

        if (pathname.startsWith('/stream/')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            const segments = pathname.split('/');
            const type = segments[2];
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
