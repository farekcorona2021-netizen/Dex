const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://ds.alooytv16.xyz';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en;q=0.9'
};

// ============================================================
// 1. جلب العنوان من Cinemeta (بدون API key)
// ============================================================
async function getTitleFromImdb(imdbId, type) {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
    const { data } = await axios.get(url, { timeout: 5000 });
    if (!data?.meta) throw new Error('Cinemeta: ما لقيت العمل');
    return {
        title: data.meta.name,
        originalTitle: data.meta.originalName || data.meta.name,
        year: data.meta.year
    };
}

// ============================================================
// 2. البحث في الموقع
// ============================================================
async function searchSite(term) {
    const url = `${BASE_URL}/home/autocompleteajax?term=${encodeURIComponent(term)}`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 6000 });
    return Array.isArray(data) ? data : [];
}

// ============================================================
// 3. البحث الذكي (إنجليزي → عربي → مختصر)
// ============================================================
async function findContent(imdbId, type) {
    const { title, originalTitle } = await getTitleFromImdb(imdbId, type);
    console.log(`🎬 العنوان: ${title} / ${originalTitle}`);

    let results = await searchSite(title);
    console.log(`🔍 بحث "${title}": ${results.length} نتيجة`);

    if (results.length === 0 && originalTitle !== title) {
        results = await searchSite(originalTitle);
        console.log(`🔍 بحث "${originalTitle}": ${results.length} نتيجة`);
    }

    if (results.length === 0) {
        const short = title.split(' ').slice(0, 2).join(' ');
        results = await searchSite(short);
        console.log(`🔍 بحث "${short}": ${results.length} نتيجة`);
    }

    return results;
}

// ============================================================
// 4. استخراج الحلقات من صفحة المسلسل
// ============================================================
async function extractEpisodes(seriesUrl) {
    const { data } = await axios.get(seriesUrl, { headers: HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);
    const episodes = [];

    // كل <div class="season"> يحتوي على مجموعة حلقات
    $('.season').each((seasonIdx, seasonEl) => {
        $(seasonEl).find('a').each((epIdx, epEl) => {
            const href = $(epEl).attr('href');
            const label = $(epEl).text().trim();
            if (!href || !href.includes('watch')) return;

            const epNum = parseInt(label.replace(/\D/g, '')) || (epIdx + 1);
            episodes.push({
                season: seasonIdx + 1,
                episode: epNum,
                label,
                url: href.startsWith('http') ? href : BASE_URL + href
            });
        });
    });

    return episodes;
}

// ============================================================
// 5. استخراج رابط الفيديو من صفحة الحلقة/الفيلم
// ============================================================
async function extractVideoUrl(pageUrl) {
    const { data } = await axios.get(pageUrl, { headers: HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);

    let src = $('video source').first().attr('src');
    if (!src) src = $('video').attr('src');

    if (!src) {
        const match = data.match(/https?:\/\/[^\s"'<>]+\.mp4/);
        if (match) src = match[0];
    }

    if (!src) return null;
    if (src.startsWith('//')) src = 'https:' + src;
    if (src.startsWith('/')) src = BASE_URL + src;
    return src;
}

// ============================================================
// 6. سحب قائمة العناصر من صفحة قائمة (أفلام أو مسلسلات)
// ============================================================
async function scrapeList(listUrl) {
    const { data } = await axios.get(listUrl, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(data);
    const items = [];

    $('.movie-container > div').each((i, el) => {
        const $el = $(el);
        const linkEl = $el.find('.movie-title a').first();
        const href = linkEl.attr('href');
        const title = linkEl.text().trim();
        const poster = $el.find('img.lazy').attr('data-src') 
                    || $el.find('img').attr('src');
        const episodesText = $el.find('.video_quality .label').text().trim();

        if (!href || !title) return;

        const slug = href.split('/').pop().replace('.html', '').replace(/\?.*/, '');

        items.push({
            id: 'alooy:' + slug,
            name: title,
            poster: poster ? (poster.startsWith('http') ? poster : BASE_URL + poster) : undefined,
            description: episodesText || undefined
        });
    });

    return items;
}

// ============================================================
// 7. كتالوج الأفلام والمسلسلات
// ============================================================
async function getMovieCatalog() {
    return await scrapeList(`${BASE_URL}/movies.html`);
}

async function getSeriesCatalog() {
    return await scrapeList(`${BASE_URL}/tv-series.html`);
}

// ============================================================
// 8. جلب stream من رابط صفحة مباشر (للكتالوج)
// ============================================================
async function getStreamsByPageUrl(pageUrl, type, season = 1, episode = 1) {
    try {
        if (type === 'series') {
            const episodes = await extractEpisodes(pageUrl);
            console.log(`📺 ${episodes.length} حلقة`);

            let target = episodes.find(
                e => e.season === parseInt(season) && e.episode === parseInt(episode)
            );
            if (!target) target = episodes[0];
            if (!target) return [];

            const videoUrl = await extractVideoUrl(target.url);
            if (!videoUrl) return [];

            return [{
                title: `AlooyTV | ${target.label}`,
                url: videoUrl,
                quality: 'HD'
            }];
        } else {
            const videoUrl = await extractVideoUrl(pageUrl);
            if (!videoUrl) return [];
            return [{ title: 'AlooyTV', url: videoUrl, quality: 'HD' }];
        }
    } catch (e) {
        console.error('❌ خطأ في getStreamsByPageUrl:', e.message);
        return [];
    }
}

// ============================================================
// 9. الدالة الرئيسية للـ stream
// ============================================================
async function getStreams(imdbId, type, season = 1, episode = 1) {
    // إذا كان ID من كتالوجنا
    if (imdbId.startsWith('alooy:')) {
        const slug = imdbId.replace('alooy:', '');
        const pageUrl = `${BASE_URL}/watch/${slug}.html`;
        return await getStreamsByPageUrl(pageUrl, type, season, episode);
    }

    // إذا كان IMDb ID عادي
    try {
        const results = await findContent(imdbId, type);
        if (results.length === 0) return [];

        const streams = [];

        for (const match of results.slice(0, 3)) {
            try {
                const pageUrl = match.url;
                console.log(`📄 جرب: ${match.title} → ${pageUrl}`);

                if (type === 'series') {
                    const episodes = await extractEpisodes(pageUrl);
                    let target = episodes.find(
                        e => e.season === parseInt(season) && e.episode === parseInt(episode)
                    );
                    if (!target) target = episodes[0];
                    if (!target) continue;

                    const videoUrl = await extractVideoUrl(target.url);
                    if (!videoUrl) continue;

                    streams.push({
                        title: `AlooyTV | ${match.title} | ${target.label}`,
                        url: videoUrl,
                        quality: 'HD'
                    });
                } else {
                    const videoUrl = await extractVideoUrl(pageUrl);
                    if (!videoUrl) continue;

                    streams.push({
                        title: `AlooyTV | ${match.title}`,
                        url: videoUrl,
                        quality: 'HD'
                    });
                }

                if (streams.length > 0) break;
            } catch (e) {
                console.log(`⚠️ ${match.url}: ${e.message}`);
            }
        }

        return streams;
    } catch (error) {
        console.error('❌ خطأ:', error.message);
        return [];
    }
}

module.exports = {
    getStreams,
    getStreamsByPageUrl,
    getMovieCatalog,
    getSeriesCatalog
};
